import db from '@models/index';
import { accessGuard } from '@/repositories/scoped-access-repository';
import type {
  ColumnLockEditorRow,
  ColumnLocksDocument,
} from '@/repositories/types/column-lock-repository.types';

function object(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function parseColumnLocks(data: unknown): ColumnLocksDocument {
  const root = object(data);
  const raw = object(root?.columnLocks);
  if (!raw) return {};
  const locks: ColumnLocksDocument = {};
  for (const [key, value] of Object.entries(raw)) {
    const entry = object(value);
    if (!entry || !Array.isArray(entry.userIds)) continue;
    const userIds = entry.userIds.filter((id): id is string => typeof id === 'string');
    locks[key] = { userIds: [...new Set(userIds)] };
  }
  return locks;
}

export class ColumnLockStore {
  public async list(parentId: NonEmptyString): Promise<ColumnLocksDocument | null> {
    const rows = await db.sqlRaw<{ data: unknown }>({
      text: `SELECT data FROM pages WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
      values: [parentId],
    }, 'query');
    return rows[0] ? parseColumnLocks(rows[0].data) : null;
  }

  public async columnBelongs(parentId: NonEmptyString, columnId: NonEmptyString): Promise<boolean> {
    const rows = await db.sqlRaw<{ found: number }>({
      text: `SELECT 1 AS found FROM page_columns
        WHERE id = ? AND parent_id = ? AND deleted_at IS NULL LIMIT 1`,
      values: [columnId, parentId],
    }, 'query');
    return rows.length === 1;
  }

  public async columnParentId(columnId: NonEmptyString): Promise<string | null> {
    const rows = await db.sqlRaw<{ parent_id: string }>({
      text: `SELECT parent_id FROM page_columns
        WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
      values: [columnId],
    }, 'query');
    return rows[0]?.parent_id ?? null;
  }

  public async rowParentId(rowId: NonEmptyString): Promise<string | null> {
    const rows = await db.sqlRaw<{ parent_id: string }>({
      text: `SELECT parent_id FROM page_edges WHERE child_id = ? LIMIT 1`,
      values: [rowId],
    }, 'query');
    return rows[0]?.parent_id ?? null;
  }

  public async canMutate(
    parentId: NonEmptyString,
    columnKey: string,
    userId: NonEmptyString,
  ): Promise<boolean> {
    const locks = await this.list(parentId);
    if (locks === null) return false;
    const lock = locks[columnKey];
    return !lock || lock.userIds.includes(userId);
  }

  public async save(
    parentId: NonEmptyString,
    columnKey: string,
    userIds: readonly NonEmptyString[],
    actorId: NonEmptyString,
  ): Promise<ColumnLocksDocument | null> {
    const path = `$.columnLocks."${columnKey}"`;
    const guard = accessGuard('page', parentId, actorId, 'write', 'lock_columns');
    const statement = userIds.length === 0
      ? {
          text: `UPDATE pages
            SET data = json_remove(COALESCE(data, '{}'), ?), updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND deleted_at IS NULL AND ${guard.text}
            RETURNING data`,
          values: [path, parentId, ...guard.values],
        }
      : {
          text: `UPDATE pages
            SET data = json_set(COALESCE(data, '{}'), ?, json(?)), updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND deleted_at IS NULL AND ${guard.text}
            RETURNING data`,
          values: [path, JSON.stringify({ userIds }), parentId, ...guard.values],
        };
    const rows = await db.sqlRaw<{ data: unknown }>(statement, 'request');
    return rows[0] ? parseColumnLocks(rows[0].data) : null;
  }

  public async listEligibleEditors(
    parentId: NonEmptyString,
  ): Promise<ColumnLockEditorRow[]> {
    const candidates = await db.sqlRaw<ColumnLockEditorRow>({
      text: `WITH RECURSIVE branch(id) AS (
        SELECT id FROM pages WHERE id = ? AND deleted_at IS NULL
        UNION
        SELECT edge.parent_id FROM page_edges edge
        JOIN branch child ON child.id = edge.child_id
        JOIN pages parent ON parent.id = edge.parent_id AND parent.deleted_at IS NULL
      ), selected_workspaces(id, organization_id) AS (
        SELECT DISTINCT workspace.id, workspace.organization_id
        FROM workspaces workspace
        JOIN workspace_members root ON root.workspace_id = workspace.id AND root.deleted_at IS NULL
        JOIN branch ON branch.id = root.page_root_id
      ), candidate_ids(id) AS (
        SELECT owner_id FROM pages WHERE id IN (SELECT id FROM branch)
        UNION SELECT collaborator.user_id FROM page_collaborators collaborator
          WHERE collaborator.page_id IN (SELECT id FROM branch) AND collaborator.deleted_at IS NULL
        UNION SELECT workspace.created_by_user_id FROM workspaces workspace
          WHERE workspace.id IN (SELECT id FROM selected_workspaces)
        UNION SELECT member.user_id FROM workspace_members member
          WHERE member.workspace_id IN (SELECT id FROM selected_workspaces) AND member.deleted_at IS NULL
        UNION SELECT organization.owner_id FROM organizations organization
          WHERE organization.id IN (SELECT organization_id FROM selected_workspaces)
        UNION SELECT member.user_id FROM organization_members member
          WHERE member.organization_id IN (SELECT organization_id FROM selected_workspaces)
            AND member.deleted_at IS NULL
      )
      SELECT user.id, user.name, user.email FROM users user
      JOIN candidate_ids candidate ON candidate.id = user.id
      ORDER BY COALESCE(user.name, user.email), user.id`,
      values: [parentId],
    }, 'query');
    if (!candidates.length) return [];

    const values: unknown[] = [];
    const statements = candidates.map((candidate) => {
      const update = accessGuard('page', parentId, candidate.id, 'write', 'update');
      // A allowlist restringe quem já pode editar; ela não concede acesso.
      // Exigir `edit_subpages` aqui tornava inelegível quem pode editar/travar
      // a própria database, embora `canManage` e as rotas de schema aceitem
      // corretamente `update + lock_columns`. Células continuam protegidas
      // pela permissão da página-linha e pelo middleware de lock.
      values.push(candidate.id, ...update.values);
      return `SELECT ? AS id WHERE ${update.text}`;
    });
    const allowed = await db.sqlRaw<{ id: string }>({
      text: statements.join(' UNION ALL '),
      values,
    }, 'query');
    const ids = new Set(allowed.map((row) => row.id));
    return candidates.filter((candidate) => ids.has(candidate.id));
  }
}

export default new ColumnLockStore();
