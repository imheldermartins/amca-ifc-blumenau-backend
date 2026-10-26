import db from '@models/index';
import { accessGuard } from '@/repositories/scoped-access-repository';
import workspaces from '@/repositories/workspace-repository';
import organizations from '@/repositories/organization-repository';
import collaborators from '@/repositories/page-collaborator-repository';
import flows from '@/repositories/flow-repository';
import { VALUE_CODECS } from '@/services/value-codec';
import type { Schema } from '@/db/schemas/index';
import pageExports from './page-export-repository.js';
import { mentionIds, parseMentionId, type MentionCatalog, type MentionScope, type MentionPerson, type MentionPageColumn } from '@/services/mentions/template';

/** Every entity is authorized independently, including transitive references. */
export class MentionStore {
  async columns(pageId: string, actor: string): Promise<MentionPageColumn[]> {
    const guard = accessGuard('page', pageId, actor, 'read', 'view');
    const rows = await db.sqlRaw<{ id: string; parent_id: string; name: string | null; type: Schema.ColumnType; data: string | null; value_data: string | null }>({
      text: `SELECT DISTINCT col.id, col.parent_id, col.name, col.type, col.data, cell.data AS value_data
        FROM pages JOIN page_edges edge ON edge.child_id = pages.id
        JOIN pages parent ON parent.id = edge.parent_id AND parent.deleted_at IS NULL
        JOIN page_columns col ON col.parent_id = parent.id AND col.deleted_at IS NULL
        LEFT JOIN page_columns_values cell ON cell.page_id = pages.id AND cell.page_column_id = col.id
        WHERE pages.id = ? AND pages.deleted_at IS NULL
          AND col.type != 'flow' AND ${guard.text}
        ORDER BY col.id`,
      values: [pageId, ...guard.values],
    }, 'query');
    const calculatedTypes = new Set(['relation', 'formula', 'extract_as']);
    const computed: Record<string, string> = {};
    if (rows.some((column) => calculatedTypes.has(column.type))) {
      const definitions = rows.filter((column) => calculatedTypes.has(column.type)).map((column) => {
        let data: Schema.PageColumnData = {};
        try { data = typeof column.data === 'string' ? JSON.parse(column.data) : column.data ?? {}; } catch { /* Invalid definitions remain unavailable. */ }
        return { ...column, data } as unknown as Schema.PageColumn;
      });
      const cells = rows.filter((column) => column.value_data != null).map((column) => ({ page_id: pageId, page_column_id: column.id, data: column.value_data })) as unknown as Schema.PageColumnValue[];
      const projected = await pageExports.row({ id: pageId, title: null }, definitions, actor, cells);
      if (rows[0]?.parent_id) await pageExports.calculated([projected], definitions, rows[0].parent_id, actor);
      Object.assign(computed, projected.values);
    }
    return rows.map((column) => {
      if (calculatedTypes.has(column.type)) return { id: column.id, name: column.name ?? '', value: computed[column.id] ?? '' };
      let value: unknown = null;
      try { value = column.value_data == null ? null : VALUE_CODECS[column.type].decode(column.value_data); } catch { /* Invalid stored cells are blank. */ }
      if (column.type === 'select' && value != null) {
        let data: { options?: { id: string; label?: string; value?: string }[] } = {};
        try { data = typeof column.data === 'string' ? JSON.parse(column.data) : column.data ?? {}; } catch { /* Invalid metadata has no selectable value. */ }
        const option = data.options?.find((option) => option.id === value);
        value = option?.value ?? option?.label ?? null;
      }
      return { id: column.id, name: column.name ?? '', value: value == null ? '' : String(value) };
    });
  }

  async page(id: string, actor: string): Promise<{ id: string; title: string | null } | undefined> {
    const guard = accessGuard('page', id, actor, 'read', 'view');
    const rows = await db.sqlRaw<{ id: string; title: string | null }>({
      text: `SELECT id, title FROM pages WHERE id = ? AND deleted_at IS NULL AND ${guard.text}`,
      values: [id, ...guard.values],
    }, 'query');
    return rows[0];
  }

  async catalog(actor: string, scope: MentionScope): Promise<MentionCatalog> {
    const current = await db.sqlRaw<MentionPerson>({ text: 'SELECT id, name, email FROM users WHERE id = ?', values: [actor] }, 'query');
    const result: MentionCatalog = { users: current };
    let workspaceId = scope.workspaceId;
    if (scope.pageId) {
      const page = await this.page(scope.pageId, actor);
      // An inaccessible page cannot fall back to a different workspace's variables.
      if (!page) return result;
      result.page = { ...page, columns: await this.columns(page.id, actor) };
      workspaceId = await collaborators.resolveWorkspaceId(scope.pageId as NonEmptyString) ?? undefined;
      const people = await flows.listPeople(scope.pageId as NonEmptyString);
      result.users = [...current, ...people.filter((person) => person.id !== actor)];
    }
    const workspace = workspaceId ? await workspaces.getForUser(workspaceId, actor) : null;
    if (workspace) result.workspace = { id: workspace.id, name: workspace.name, data: workspace.data };
    const organizationId = scope.pageId ? workspace?.organizationId : workspace?.organizationId ?? scope.organizationId;
    const organization = organizationId ? await organizations.getForUser(organizationId, actor) : null;
    if (organization) result.organization = { id: organization.id, name: organization.name, data: organization.data };
    return result;
  }

  async resolve(actor: string, scope: MentionScope, ids: string[]): Promise<Record<string, string | null>> {
    const catalog = await this.catalog(actor, scope);
    const cache = new Map<string, Promise<string | null>>();
    type Entity = { id: string; name?: string | null; title?: string | null; data?: Record<string, unknown> };
    const entities = new Map<string, Promise<Entity | null | undefined>>();
    const pageColumns = new Map<string, Promise<MentionPageColumn[]>>();
    if (catalog.page?.columns) pageColumns.set(catalog.page.id, Promise.resolve(catalog.page.columns));
    let budget = 100;
    const raw = async (id: string): Promise<string | null> => {
      const ref = parseMentionId(id);
      if (!ref) return null;
      if (ref.kind === 'pages' && ref.field.startsWith('columns.')) {
        if (!pageColumns.has(ref.entityId)) pageColumns.set(ref.entityId, this.columns(ref.entityId, actor));
        return (await pageColumns.get(ref.entityId))?.find((column) => column.id === ref.field.slice(8))?.value ?? null;
      }
      let entity: Record<string, unknown> | null | undefined;
      const key = `${ref.kind}:${ref.entityId}`;
      if (ref.kind === 'users') entity = catalog.users.find((user) => user.id === ref.entityId) as unknown as Record<string, unknown>;
      else {
        if (!entities.has(key)) {
          entities.set(key, ref.kind === 'pages' ? this.page(ref.entityId, actor)
            : ref.kind === 'workspace' ? workspaces.getForUser(ref.entityId, actor)
              : organizations.getForUser(ref.entityId, actor));
        }
        entity = await entities.get(key) as Record<string, unknown> | null | undefined;
      }
      if (!entity) return null;
      const data = entity.data;
      const value = ref.field.startsWith('data.')
        ? data && typeof data === 'object' && Object.hasOwn(data, ref.field.slice(5)) ? (data as Record<string, unknown>)[ref.field.slice(5)] : null
        : entity[ref.field];
      return typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : null;
    };
    const expand = async (id: string, path: Set<string>): Promise<string | null> => {
      if (path.has(id) || path.size >= 8) return null;
      // Resolve sequentially below to ensure no promises can wait on each other in a cycle.
      if (cache.has(id)) return cache.get(id)!;
      if (--budget < 0) return null;
      const nextPath = new Set(path).add(id);
      const promise = (async () => {
        let value = await raw(id);
        if (value === null || value.length > 20_000) return null;
        for (const child of mentionIds(value)) {
          const replacement = await expand(child, nextPath);
          // A denied/missing/cyclic dependency makes the enclosing value unavailable.
          if (replacement === null) return null;
          value = value.split(`@{${child}}`).join(replacement);
          if (value.length > 20_000) return null;
        }
        return value;
      })();
      cache.set(id, promise);
      return promise;
    };
    const result: Record<string, string | null> = {};
    for (const id of ids) result[id] = await expand(id, new Set());
    return result;
  }
}
export default new MentionStore();
