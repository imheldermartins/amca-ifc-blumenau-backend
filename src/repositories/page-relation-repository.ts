import db from '@models/index';
import type { Schema } from '@/db/schemas/index';
import { accessGuard, correlatedPageReadGuard } from '@/repositories/scoped-access-repository';
import { simplifySqlText, simplifyText } from '@/utils/slugify';
import { ULID_RE } from '@/utils/ulid';
import {cellJsonSql, cellTypeSql, cellValueSql} from '@/repositories/page-json-value-sql';

export interface RelationCatalogPage {
  items: Array<{ id: string; title: string | null }>;
  nextCursor: string | null;
}

export class PageRelationError extends Error {
  constructor(public readonly status: 400 | 403 | 404 | 409, message: string) {
    super(message);
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function relationConfig(column: { data: unknown }): Schema.RelationConfig | null {
  const value = asObject(column.data).relation;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const config = value as Record<string, unknown>;
  return config.version === 1 && typeof config.targetDatabaseId === 'string' && ULID_RE.test(config.targetDatabaseId)
    ? config as unknown as Schema.RelationConfig
    : null;
}

function rollupConfig(column: { data: unknown }): Schema.RollupConfig | null {
  const value = asObject(column.data).rollup;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const config = value as Record<string, unknown>;
  if (config.version !== 1 || typeof config.relationColumnId !== 'string'
    || !['count', 'sum', 'min', 'max'].includes(String(config.operation))) return null;
  if (config.operation !== 'count' && typeof config.targetColumnId !== 'string') return null;
  return config as unknown as Schema.RollupConfig;
}

function limitOf(value: number | undefined): number {
  return Math.min(50, Math.max(1, Number.isSafeInteger(value) ? value! : 25));
}

/** SQL de domínio de Relação/Resumo permanece concentrado neste repositório. */
export class PageRelationRepository {
  constructor(private readonly execute: typeof db.sqlRaw = db.sqlRaw) {}
  private async touchDatabases(ids: readonly string[]): Promise<Array<{ pageId: string }>> {
    const unique = [...new Set(ids.filter((id) => ULID_RE.test(id)))];
    if (!unique.length) return [];
    await this.execute({
      text: `UPDATE pages SET updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id IN (${unique.map(() => '?').join(',')}) AND deleted_at IS NULL`,
      values: unique,
    }, 'execute');
    const rows = await this.execute<{ id: string }>({
      text: `SELECT id FROM pages WHERE id IN (${unique.map(() => '?').join(',')}) AND deleted_at IS NULL`,
      values: unique,
    }, 'query');
    return rows.map((row) => ({ pageId: row.id }));
  }

  async invalidateDatabasesReferencingPage(targetPageId: string): Promise<Array<{ pageId: string }>> {
    if (!ULID_RE.test(targetPageId)) return [];
    const databases = await this.execute<{ page_id: string }>({
      text: `SELECT DISTINCT definition.parent_id AS page_id FROM page_columns_values cell
        JOIN page_columns definition ON definition.id=cell.page_column_id AND definition.type='relation'
        JOIN json_each(${cellJsonSql('cell')}, '$.value') relation
        JOIN pages source ON source.id=definition.parent_id AND source.deleted_at IS NULL
        WHERE relation.type='text' AND relation.value=? AND definition.deleted_at IS NULL`,
      values: [targetPageId],
    }, 'query');
    return this.touchDatabases(databases.map((entry) => entry.page_id));
  }

  async invalidateDatabasesReferencingDatabase(targetDatabaseId: string): Promise<Array<{ pageId: string }>> {
    if (!ULID_RE.test(targetDatabaseId)) return [];
    const databases = await this.execute<{ page_id: string }>({
      text: `SELECT DISTINCT source_column.parent_id AS page_id FROM page_columns_values cell
        JOIN page_columns source_column ON source_column.id=cell.page_column_id AND source_column.type='relation' AND source_column.deleted_at IS NULL
        JOIN json_each(${cellJsonSql('cell')}, '$.value') relation ON relation.type='text'
        JOIN page_edges target_edge ON target_edge.child_id=relation.value AND target_edge.parent_id=?
        JOIN pages source ON source.id=source_column.parent_id AND source.deleted_at IS NULL`,
      values: [targetDatabaseId],
    }, 'query');
    return this.touchDatabases(databases.map((entry) => entry.page_id));
  }

  async validateRelationConfig(sourceDatabaseId: string, config: Schema.RelationConfig, userId: string): Promise<void> {
    if (!ULID_RE.test(sourceDatabaseId) || !ULID_RE.test(config.targetDatabaseId)) {
      throw new PageRelationError(400, 'Configuração de Relação inválida');
    }
    const targetGuard = accessGuard('page', config.targetDatabaseId, userId, 'read', 'view');
    const rows = await this.execute<{ valid: number }>({
      text: `WITH RECURSIVE source_anc(id) AS (
          SELECT ? UNION SELECT edge.parent_id FROM page_edges edge JOIN source_anc child ON child.id=edge.child_id
        ), target_anc(id) AS (
          SELECT ? UNION SELECT edge.parent_id FROM page_edges edge JOIN target_anc child ON child.id=edge.child_id
        )
        SELECT 1 AS valid FROM workspace_members source_member
        JOIN source_anc ON source_anc.id=source_member.page_root_id
        JOIN workspace_members target_member ON target_member.workspace_id=source_member.workspace_id
        JOIN target_anc ON target_anc.id=target_member.page_root_id
        WHERE source_member.deleted_at IS NULL AND target_member.deleted_at IS NULL
          AND ${targetGuard.text} LIMIT 1`,
      values: [sourceDatabaseId, config.targetDatabaseId, ...targetGuard.values],
    }, 'query');
    if (!rows[0]) throw new PageRelationError(403, 'A Relação deve apontar para uma database legível do mesmo workspace');
  }

  async validateRollupConfig(parentId: string, config: Schema.RollupConfig, userId: string): Promise<Schema.RollupResult> {
    const [relation] = await this.execute<{ id: string; data: string }>({
      text: `SELECT id,data FROM page_columns WHERE id=? AND parent_id=? AND type='relation' AND deleted_at IS NULL`,
      values: [config.relationColumnId, parentId],
    }, 'query');
    if (!relation) throw new PageRelationError(400, 'A coluna de Relação do Resumo é inválida');
    const parsed = asObject(relation.data ? JSON.parse(relation.data) : null);
    const target = relationConfig({ data: parsed });
    if (!target) throw new PageRelationError(400, 'A coluna de Relação está sem configuração');
    await this.validateRelationConfig(parentId, target, userId);
    if (config.operation === 'count') return { type: 'numeric' };
    const [numeric] = await this.execute<{ type: string; data: string | null }>({
      text: `SELECT type,data FROM page_columns WHERE id=? AND parent_id=? AND type='numeric' AND deleted_at IS NULL`,
      values: [config.targetColumnId, target.targetDatabaseId],
    }, 'query');
    if (!numeric) throw new PageRelationError(400, 'A propriedade do Resumo deve ser numérica');
    const data = asObject(numeric.data ? JSON.parse(numeric.data) : null);
    const format = data.format === 'percentage' || data.format === 'currency' ? data.format : undefined;
    return {
      type: 'numeric',
      ...(format && { format }),
      ...(format === 'currency' && data.currency === 'BRL' && { currency: 'BRL' }),
    };
  }

  async assertRelationCanChange(columnId: string, nextTargetDatabaseId: string): Promise<void> {
    const [row] = await this.execute<{ current_target: string | null; has_values: number; has_rollups: number }>({
      text: `SELECT json_extract(data,'$.relation.targetDatabaseId') AS current_target,
        EXISTS(SELECT 1 FROM page_columns_values WHERE page_column_id=page_columns.id) AS has_values,
        EXISTS(SELECT 1 FROM page_columns dependent WHERE dependent.parent_id=page_columns.parent_id
          AND dependent.type='rollup' AND dependent.deleted_at IS NULL
          AND json_extract(dependent.data,'$.rollup.relationColumnId')=page_columns.id) AS has_rollups
        FROM page_columns WHERE id=? AND deleted_at IS NULL`,
      values: [columnId],
    }, 'query');
    if (row && row.current_target && row.current_target !== nextTargetDatabaseId && (row.has_values || row.has_rollups)) {
      throw new PageRelationError(409, 'A database da Relação não pode ser trocada enquanto houver valores ou Resumos dependentes');
    }
  }

  async assertNoDependentRollups(columnId: string): Promise<void> {
    const [row] = await this.execute<{ dependent: number }>({
      text: `SELECT EXISTS(SELECT 1 FROM page_columns relation JOIN page_columns dependent ON dependent.parent_id=relation.parent_id
        WHERE relation.id=? AND dependent.type='rollup' AND dependent.deleted_at IS NULL
          AND json_extract(dependent.data,'$.rollup.relationColumnId')=relation.id) AS dependent`,
      values: [columnId],
    }, 'query');
    if (row?.dependent) throw new PageRelationError(409, 'A Relação possui Resumos dependentes');
  }

  async prepareRelationTargets(column: Schema.PageColumn, sourcePageId: string, requested: string[], userId: string): Promise<string[]> {
    const config = relationConfig(column);
    if (!config || !column.parent_id) throw new PageRelationError(400, 'A coluna de Relação está sem configuração');
    await this.validateRelationConfig(column.parent_id, config, userId);
    const unique = [...new Set(requested)];
    if (unique.length !== requested.length || unique.length > 250 || unique.some((id) => !ULID_RE.test(id))) {
      throw new PageRelationError(400, 'Relação inválida: informe até 250 páginas sem duplicatas');
    }
    const guard = correlatedPageReadGuard('target.id', userId);
    const visibleRequested = unique.length ? await this.execute<{ id: string }>({
      text: `SELECT target.id FROM pages target JOIN page_edges edge ON edge.child_id=target.id AND edge.parent_id=?
        WHERE target.id IN (${unique.map(() => '?').join(',')}) AND target.deleted_at IS NULL AND ${guard.text}`,
      values: [config.targetDatabaseId, ...unique, ...guard.values],
    }, 'query') : [];
    if (visibleRequested.length !== unique.length) {
      throw new PageRelationError(400, 'Uma ou mais páginas não pertencem à database de destino ou não estão acessíveis');
    }

    const existingGuard = correlatedPageReadGuard('target.id', userId);
    const existing = await this.execute<{ target_page_id: string; visible: number }>({
      text: `SELECT relation.value AS target_page_id,
        CASE WHEN target.id IS NOT NULL AND target.deleted_at IS NULL AND ${existingGuard.text} THEN 1 ELSE 0 END AS visible
        FROM page_columns_values cell JOIN json_each(${cellJsonSql('cell')}, '$.value') relation ON relation.type='text'
        LEFT JOIN pages target ON target.id=relation.value
        WHERE cell.page_id=? AND cell.page_column_id=? ORDER BY CAST(relation.key AS INTEGER)`,
      values: [...existingGuard.values, sourcePageId, column.id],
    }, 'query');
    const hidden = existing.filter((entry) => entry.visible !== 1).map((entry) => entry.target_page_id);
    const merged = [...hidden, ...unique.filter((id) => !hidden.includes(id))];
    if (merged.length > 250) throw new PageRelationError(409, 'A Relação atingiu o limite de 250 páginas');
    return merged;
  }

  async listDatabases(workspaceId: string, userId: string, search?: string, cursor?: string, limit?: number): Promise<RelationCatalogPage> {
    if (!ULID_RE.test(workspaceId) || (cursor !== undefined && !ULID_RE.test(cursor))) throw new PageRelationError(400, 'Paginação inválida');
    const size = limitOf(limit), guard = correlatedPageReadGuard('candidate.id', userId), normalized = simplifyText(search?.trim() ?? '');
    const title = simplifySqlText("COALESCE(candidate.title,'')");
    const rows = await this.execute<{ id: string; title: string | null }>({
      text: `WITH RECURSIVE roots(id) AS (
          SELECT member.page_root_id FROM workspace_members member
          WHERE member.workspace_id=? AND member.deleted_at IS NULL
            AND EXISTS(SELECT 1 FROM workspace_members actor
              WHERE actor.workspace_id=member.workspace_id AND actor.user_id=? AND actor.deleted_at IS NULL)
        ), branch(id) AS (
          SELECT id FROM roots UNION SELECT edge.child_id FROM page_edges edge JOIN branch parent ON parent.id=edge.parent_id
        )
        SELECT candidate.id,candidate.title FROM branch JOIN pages candidate ON candidate.id=branch.id
        WHERE candidate.deleted_at IS NULL AND candidate.id>? AND ${guard.text}
          AND (?='' OR instr(${title},?)>0)
        ORDER BY candidate.id LIMIT ?`,
      values: [workspaceId, userId, cursor ?? '', ...guard.values, normalized, normalized, size + 1],
    }, 'query');
    const items = rows.slice(0, size);
    return { items, nextCursor: rows.length > size ? items.at(-1)?.id ?? null : null };
  }

  async listOptions(databaseId: string, userId: string, search?: string, cursor?: string, limit?: number): Promise<RelationCatalogPage> {
    if (!ULID_RE.test(databaseId) || (cursor !== undefined && !ULID_RE.test(cursor))) throw new PageRelationError(400, 'Paginação inválida');
    const databaseGuard = accessGuard('page', databaseId, userId, 'read', 'view');
    const rowGuard = correlatedPageReadGuard('candidate.id', userId), size = limitOf(limit), normalized = simplifyText(search?.trim() ?? '');
    const title = simplifySqlText("COALESCE(candidate.title,'')");
    const rows = await this.execute<{ id: string; title: string | null }>({
      text: `SELECT candidate.id,candidate.title FROM pages candidate JOIN page_edges edge ON edge.child_id=candidate.id
        WHERE edge.parent_id=? AND candidate.deleted_at IS NULL AND candidate.id>? AND ${databaseGuard.text} AND ${rowGuard.text}
          AND (?='' OR instr(${title},?)>0)
        ORDER BY candidate.id LIMIT ?`,
      values: [databaseId, cursor ?? '', ...databaseGuard.values, ...rowGuard.values, normalized, normalized, size + 1],
    }, 'query');
    const items = rows.slice(0, size);
    return { items, nextCursor: rows.length > size ? items.at(-1)?.id ?? null : null };
  }

  async resolveVisibleTargets(ids: readonly string[], userId: string): Promise<Record<string, { id: string; title: string | null }>> {
    const result: Record<string, { id: string; title: string | null }> = {};
    const unique = [...new Set(ids.filter((id) => ULID_RE.test(id)))];
    for (let offset = 0; offset < unique.length; offset += 300) {
      const chunk = unique.slice(offset, offset + 300), guard = correlatedPageReadGuard('target.id', userId);
      const rows = await this.execute<{ id: string; title: string | null }>({
        text: `SELECT target.id,target.title FROM pages target WHERE target.id IN (${chunk.map(() => '?').join(',')})
          AND target.deleted_at IS NULL AND ${guard.text}`,
        values: [...chunk, ...guard.values],
      }, 'query');
      rows.forEach((row) => { result[row.id] = row; });
    }
    return result;
  }

  async resolveRollupValues(column: { data: unknown }, sourcePageIds: readonly string[], userId: string): Promise<Record<string, number | null>> {
    const config = rollupConfig(column);
    if (!config || sourcePageIds.length === 0) return {};
    const guard = correlatedPageReadGuard('target.id', userId);
    const aggregate = config.operation === 'count'
      ? 'COUNT(target.id)'
      : `${config.operation.toUpperCase()}(CASE WHEN ${cellTypeSql('value')} IN ('integer','real') THEN ${cellValueSql('value')} END)`;
    const rows = await this.execute<{ source_page_id: string; result: number | null }>({
      text: `SELECT cell.page_id AS source_page_id,${aggregate} AS result FROM page_columns_values cell
        JOIN json_each(${cellJsonSql('cell')}, '$.value') relation ON relation.type='text'
        JOIN pages target ON target.id=relation.value AND target.deleted_at IS NULL
        ${config.operation === 'count' ? '' : 'LEFT JOIN page_columns_values value ON value.page_id=target.id AND value.page_column_id=?'}
        WHERE cell.page_column_id=? AND cell.page_id IN (${sourcePageIds.map(() => '?').join(',')})
          AND ${guard.text} GROUP BY cell.page_id`,
      values: [...(config.operation === 'count' ? [] : [config.targetColumnId]), config.relationColumnId, ...sourcePageIds, ...guard.values],
    }, 'query');
    const resolved: Record<string, number | null> = {};
    sourcePageIds.forEach((id) => { resolved[id] = config.operation === 'min' || config.operation === 'max' ? null : 0; });
    rows.forEach((row) => { resolved[row.source_page_id] = row.result ?? (config.operation === 'min' || config.operation === 'max' ? null : 0); });
    return resolved;
  }

  async resolveColumnMetadata<T extends { id: string; type: string | null; data: unknown; parent_id?: string | null }>(columns: T[], userId: string): Promise<T[]> {
    return Promise.all(columns.map(async (column) => {
      if (column.type !== 'rollup' || !column.parent_id) return column;
      const config = rollupConfig(column);
      if (!config) return column;
      try {
        const rollupResult = await this.validateRollupConfig(column.parent_id, config, userId);
        return { ...column, data: { ...asObject(column.data), rollupResult } } as T;
      } catch {
        const data = { ...asObject(column.data) };
        delete data.rollupResult;
        return { ...column, data } as T;
      }
    }));
  }
}

export default new PageRelationRepository();
