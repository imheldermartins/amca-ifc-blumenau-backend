import db from '@models/index';
import formulas from '@/repositories/page-formula-repository';
import type { Schema } from '@/db/schemas/index';
import { accessGuard, correlatedPageReadGuard } from '@/repositories/scoped-access-repository';
import { readOrderRevision } from '@/repositories/page-view-row-order';
import { compileQueryFilters, type QueryColumn, type QuerySqlFragment } from '@/repositories/page-view-query-filters';
import { PageViewQueryCursor, PageViewQueryError, queryFingerprint, type QueryCursorContext } from '@/repositories/page-view-query-cursor';
import { reconcileViewFilters } from '@/services/view-filters-v2';
import pageRelationRepository, { type PageRelationRepository } from '@/repositories/page-relation-repository';
import {cellDateIntervalSql, cellTypeSql, cellValueSql} from '@/repositories/page-json-value-sql';
import {
  PAGE_VIEW_BATCH_SIZE, PAGE_VIEW_UNASSIGNED, pageViewScopeKey,
  type PageViewQueryGroup, type PageViewQueryProjection, type PageViewQueryRequest, type PageViewQueryScope, type PageViewQueryWindow,
  type QueryDatasetRow, type QueryFilters, type QueryGroupValue, type QueryViewKind,
} from '@/services/pages/views/page-view-query-contract';

export const QUERY_FALLBACK_VIEW = '01KXVZ0000FALLBACKTABLE001';
type QueryExecutor = <T>(statement: QuerySqlFragment) => Promise<T[]>;
interface MetadataPage { id: string; title: string | null; owner_id: string; created_at: string; updated_at: string; data: Record<string, unknown> }
export interface PageViewQueryMetadata { page: MetadataPage; columns: QueryColumn[] }
interface SqlPage extends Omit<MetadataPage, 'data'> { data: string }
interface SqlColumn extends Omit<QueryColumn, 'data'> { data: string | null }
interface QueryContext extends PageViewQueryMetadata { view: Record<string, unknown>; kind: QueryViewKind; filters: QueryFilters; orderRevision: number; queryKey: string; userId: string; rankParentId: string }
interface SqlRow { id: string; title: string | null; rank_key: string; window_key?: string; page_columns?: string }
interface SqlGroup { group_json: string; total: number; first_rank: string; first_id: string }
interface SqlCount { total: number }
interface SqlDay { day: string; total: number; checked?: number }
interface BaseQuery { sql: QuerySqlFragment; groupColumnIds: string[]; selectColumn?: QueryColumn; dateColumn?: QueryColumn; checkboxColumn?: QueryColumn }
interface AllocatedStream { scope: PageViewQueryScope; total: number; quota: number }
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function parseData(value: string | null): Record<string, unknown> { try { return object(value ? JSON.parse(value) : null); } catch { return {}; } }
function stringList(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []; }
function utcDay(value: string): number { return Date.parse(`${value.slice(0, 10)}T00:00:00.000Z`); }
function dateBound(value: string, end: boolean): number { return /^\d{4}-\d{2}-\d{2}$/.test(value) ? utcDay(value) + (end ? 86_400_000 - 1 : 0) : Date.parse(value); }
function groupToken(alias: string): string {
  const kind = cellTypeSql(alias), value = cellValueSql(alias);
  return `CASE WHEN ${kind} IS NULL OR ${kind} = 'null' THEN NULL
    WHEN ${kind} IN ('true','false') THEN 'boolean:' || ${kind}
    WHEN ${kind} IN ('integer','real') THEN 'number:' || CAST(${value} AS TEXT)
    WHEN ${kind} = 'text' THEN 'string:' || CAST(${value} AS TEXT)
    ELSE ${kind} || ':' || json(${value}) END`;
}
function titleToken(): string { return "CASE WHEN candidate.title IS NULL THEN NULL ELSE 'string:' || candidate.title END"; }

/** SQL owns membership, counts, grouping and bounded materialization. */
export class PageViewQueryStore {
  constructor(
    private readonly execute: QueryExecutor = (statement) => db.sqlRaw(statement as SqlStatement, 'query'),
    private readonly readRevision: (view: unknown) => number = readOrderRevision,
    private readonly cursor = new PageViewQueryCursor(),
    private readonly relations: PageRelationRepository = pageRelationRepository,
  ) {}

  async metadata(pageId: string, userId: string): Promise<PageViewQueryMetadata> {
    const guard = accessGuard('page', pageId, userId, 'read', 'view');
    const [page] = await this.execute<SqlPage>({
      text: `SELECT id,title,owner_id,created_at,updated_at,
        COALESCE((SELECT json_group_object(entry.key, json(CASE WHEN entry.type = 'object' THEN json_remove(entry.value, '$.orderedRows') ELSE json_quote(entry.value) END))
          FROM json_each(CASE WHEN json_valid(pages.data) THEN pages.data ELSE '{}' END) entry), '{}') AS data
        FROM pages WHERE id = ? AND deleted_at IS NULL AND ${guard.text}`,
      values: [pageId, ...guard.values],
    });
    if (!page) throw new PageViewQueryError(404, '"Page" não encontrado');
    const columns = await this.execute<SqlColumn>({ text: 'SELECT id,name,type,data,parent_id FROM page_columns WHERE parent_id = ? AND deleted_at IS NULL ORDER BY id', values: [pageId] });
    const parsed = columns.map((column) => ({ ...column, data: parseData(column.data) }));
    return { page: { ...page, data: parseData(page.data) }, columns: await this.relations.resolveColumnMetadata(parsed, userId) };
  }

  async query(pageId: string, viewId: string, userId: string, request: PageViewQueryRequest): Promise<PageViewQueryProjection> {
    const projection = await this.readProjection(pageId, viewId, userId, request);
    await this.requirePageAccess(pageId, userId);
    return projection;
  }

  /** Revalida a autorização ao final sem depender de contador ou revisão persistida. */
  private async requirePageAccess(pageId: string, userId: string): Promise<void> {
    const guard = accessGuard('page', pageId, userId, 'read', 'view');
    const [allowed] = await this.execute<{allowed: number}>({
      text: `SELECT 1 AS allowed FROM pages WHERE id = ? AND deleted_at IS NULL AND ${guard.text}`,
      values: [pageId, ...guard.values],
    });
    if (!allowed) throw new PageViewQueryError(404, '"Page" não encontrado');
  }

  private async readProjection(pageId: string, viewId: string, userId: string, request: PageViewQueryRequest): Promise<PageViewQueryProjection> {
    const metadata = await this.metadata(pageId, userId);
    const view = viewId === QUERY_FALLBACK_VIEW ? { view: 'table' } : object(metadata.page.data[viewId]);
    if (typeof view.view !== 'string' || view.deletedAt != null) throw new PageViewQueryError(404, 'View não encontrada');
    const kind = view.view as QueryViewKind;
    if (request.view !== undefined && request.view !== kind) {
      throw new PageViewQueryError(409, 'A visualização mudou. Recarregue a página.', 'VIEW_CHANGED');
    }
    const filters = request.filters ?? reconcileViewFilters(view.filters, [
      { id: 'page_title', type: 'text' }, ...metadata.columns.map((column) => ({ id: column.id, type: column.type as Schema.ColumnType,
        ...(Array.isArray(column.data?.options) && { options: column.data.options as Schema.SelectOption[] }) })),
    ]);
    if (viewId !== QUERY_FALLBACK_VIEW && kind !== 'form') await this.requireReadyOrder(pageId, viewId, view);
    const orderRevision = viewId === QUERY_FALLBACK_VIEW ? 0 : this.readRevision(view);
    const context: QueryContext = { ...metadata, view, kind, filters, orderRevision, userId, rankParentId: pageId,
      queryKey: queryFingerprint({ pageId, viewId, kind, filters: { clauses: filters.clauses, groupBy: filters.groupBy }, board: view.board, dateColumnId: view.dateColumnId, heatmap: view.heatmap }),
    };
    if (kind === 'form') return { version: 1, kind, pageId, viewId, queryKey: context.queryKey, orderRevision, total: 0, windows: [] };
    const base = await this.baseQuery(context, viewId, request.scope);
    const [count] = await this.execute<SqlCount>({ text: `WITH filtered AS (${base.sql.text}) SELECT COUNT(*) AS total FROM filtered`, values: base.sql.values });
    const projection: PageViewQueryProjection = { version: 1, kind, pageId, viewId, queryKey: context.queryKey, orderRevision,
      total: count?.total ?? 0, windows: [] };
    const limit = request.limit ?? PAGE_VIEW_BATCH_SIZE;
    if (request.scope && request.scope.type !== 'root') {
      if (request.scope.type === 'board' && kind !== 'board' || request.scope.type === 'group' && kind !== 'table'
        || request.scope.type === 'calendar' && !['calendar', 'timeline'].includes(kind)
        || request.scope.type === 'heatmap' && kind !== 'heatmap' || request.scope.type === 'graph' && kind !== 'graph') {
        throw new PageViewQueryError(400, 'Escopo incompatível com a visualização');
      }
      const scoped = this.scopeCondition(base, request.scope);
      const [scopeCount] = await this.execute<SqlCount>({ text: `WITH filtered AS (${base.sql.text}) SELECT COUNT(*) AS total FROM filtered WHERE ${scoped.text}`, values: [...base.sql.values, ...scoped.values] });
      if (request.metadataOnly) projection.windows = [];
      else if (kind === 'calendar' && request.scope.type === 'calendar' && request.scope.day === undefined) {
        projection.days = await this.calendarCounts(base, request.scope.from, request.scope.to);
        projection.windows = [await this.readCalendarPreview(context, base, request.scope, limit, scopeCount?.total ?? 0)];
      } else if (kind === 'heatmap' && request.scope.type === 'heatmap' && request.scope.day === undefined) {
        const aggregate = await this.heatmapCounts(base, request.scope.from, request.scope.to);
        projection.heatmapDays = aggregate.days;
        projection.ignoredRanges = aggregate.ignoredRanges;
      } else projection.windows = [await this.readWindow(context, base, request.scope, scopeCount?.total ?? 0, limit, request)];
      if (base.selectColumn) projection.selectColumnId = base.selectColumn.id;
      if (base.dateColumn) projection.dateColumnId = base.dateColumn.id;
      if (base.checkboxColumn) projection.checkboxColumnId = base.checkboxColumn.id;
      if (request.scope.type === 'calendar' && !projection.days) projection.days = await this.calendarCounts(base, request.scope.from, request.scope.to);
      if (request.scope.type === 'heatmap' && !projection.heatmapDays) {
        const aggregate = await this.heatmapCounts(base, request.scope.from, request.scope.to);
        projection.heatmapDays = aggregate.days;
        projection.ignoredRanges = aggregate.ignoredRanges;
      }
      if (kind === 'board') projection.groups = await this.boardGroups(base, context);
      if (projection.groups) this.attachWindows(projection.groups, projection.windows);
      return this.enrichProjection(projection, context);
    }
    if (kind === 'board') {
      if (!base.selectColumn) return projection;
      projection.selectColumnId = base.selectColumn.id;
      const groups = await this.boardGroups(base, context);
      projection.groups = groups;
      if (request.metadataOnly) return projection;
      const collapsed = new Set(stringList(object(view.board).collapsedOptionIds));
      const visible = request.visibleGroupKeys ? new Set(request.visibleGroupKeys) : null;
      const streams = this.allocate(groups.filter((group) => !collapsed.has(group.value ?? '') && (!visible || visible.has(group.key))), limit,
        (group) => ({ type: 'board', optionId: group.value ?? PAGE_VIEW_UNASSIGNED }));
      projection.windows = await this.readAllocated(context, base, streams);
      this.seedEmptyWindows(context, groups, projection.windows);
      this.attachWindows(groups, projection.windows);
    } else if (kind === 'table' && base.groupColumnIds.length) {
      const leafGroups = await this.tableGroups(base, context, request.groupCursor);
      projection.groups = leafGroups.groups;
      projection.groupsNextCursor = leafGroups.nextCursor;
      if (request.metadataOnly) return projection;
      const visible = request.visibleGroupKeys ? new Set(request.visibleGroupKeys) : null;
      const streams = this.allocate(leafGroups.leaves.filter((group) => !visible || visible.has(group.key)), limit, (group) => ({ type: 'group', path: group.path }));
      projection.windows = await this.readAllocated(context, base, streams);
      this.seedEmptyWindows(context, leafGroups.leaves, projection.windows);
      this.attachWindows(projection.groups, projection.windows);
    } else if (kind === 'calendar' || kind === 'timeline') {
      if (!base.dateColumn) return projection;
      projection.dateColumnId = base.dateColumn.id;
      const [first] = await this.execute<{ date_ms: number | null }>({ text: `WITH filtered AS (${base.sql.text}) SELECT MIN(date_start_ms) AS date_ms FROM filtered`, values: base.sql.values });
      const firstDate = first?.date_ms == null ? new Date() : new Date(first.date_ms);
      const initialDate = firstDate.toISOString().slice(0, 10);
      projection.initialDate = initialDate;
      const from = `${initialDate.slice(0, 7)}-01`, next = new Date(`${from}T00:00:00.000Z`);
      next.setUTCMonth(next.getUTCMonth() + 1); next.setUTCDate(0);
      const to = next.toISOString().slice(0, 10);
      projection.days = await this.calendarCounts(base, from, to);
      if (request.metadataOnly) return projection;
      const scope: PageViewQueryScope = { type: 'calendar', from, to }, condition = this.scopeCondition(base, scope);
      const [periodCount] = await this.execute<SqlCount>({ text: `WITH filtered AS (${base.sql.text}) SELECT COUNT(*) AS total FROM filtered WHERE ${condition.text}`, values: [...base.sql.values, ...condition.values] });
      projection.windows = [kind === 'calendar'
        ? await this.readCalendarPreview(context, base, scope, limit, periodCount?.total ?? 0)
        : await this.readWindow(context, base, scope, periodCount?.total ?? 0, limit, request)];
    } else if (kind === 'heatmap') {
      if (!base.dateColumn || !base.checkboxColumn) return projection;
      projection.dateColumnId = base.dateColumn.id;
      projection.checkboxColumnId = base.checkboxColumn.id;
      const config = object(view.heatmap), period = object(config.period), now = new Date();
      let from: string, to: string;
      if (period.mode === 'year') {
        from = `${now.getUTCFullYear()}-01-01`;
        to = `${now.getUTCFullYear()}-12-31`;
      } else {
        const count = Math.min(12, Math.max(1, Number(period.monthCount) || 1));
        const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - count + 1, 1));
        const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
        from = start.toISOString().slice(0, 10); to = end.toISOString().slice(0, 10);
      }
      const aggregate = await this.heatmapCounts(base, from, to);
      projection.heatmapDays = aggregate.days;
      projection.ignoredRanges = aggregate.ignoredRanges;
    } else {
      const scope: PageViewQueryScope = kind === 'graph' ? { type: 'graph', parentId: pageId } : { type: 'root' };
      if (!request.metadataOnly) projection.windows = [await this.readWindow(context, base, scope, projection.total, limit, request)];
    }
    return this.enrichProjection(projection, context);
  }

  private async requireReadyOrder(parentId: string, viewId: string, view: Record<string, unknown>): Promise<void> {
    if (object(view.rowOrder).version !== 2) throw new PageViewQueryError(409, 'A paginação precisa ser preparada pelo administrador.', 'PAGINATION_NOT_READY');
    const [missing] = await this.execute<{ missing: number }>({ text: `SELECT EXISTS(SELECT 1 FROM page_edges edge JOIN pages child ON child.id=edge.child_id AND child.deleted_at IS NULL
      WHERE edge.parent_id=? AND NOT EXISTS(SELECT 1 FROM page_view_row_order position WHERE position.edge_id=edge.id AND position.view_id=?)) AS missing`, values: [parentId, viewId] });
    if (missing?.missing) throw new PageViewQueryError(409, 'A paginação precisa ser preparada pelo administrador.', 'PAGINATION_NOT_READY');
  }

  private async baseQuery(context: QueryContext, viewId: string, scope?: PageViewQueryScope): Promise<BaseQuery> {
    const parentId = scope?.type === 'graph' ? scope.parentId : context.page.id;
    if (scope?.type === 'graph' && parentId !== context.page.id) {
      const guard = accessGuard('page', parentId, context.userId, 'read', 'subpages');
      const [allowed] = await this.execute<{ allowed: number }>({ text: `WITH RECURSIVE branch(id) AS (SELECT ? UNION SELECT edge.child_id FROM page_edges edge JOIN branch ON edge.parent_id = branch.id JOIN pages child ON child.id = edge.child_id AND child.deleted_at IS NULL)
        SELECT 1 AS allowed FROM branch WHERE id = ? AND ${guard.text}`, values: [context.page.id, parentId, ...guard.values] });
      if (!allowed) throw new PageViewQueryError(404, 'Ramo não encontrado');
    }
    // The legacy Graph applied view filters to roots; explicitly opened branches
    // show their authorized children independently of the root's column schema.
    const filters = compileQueryFilters(context.columns, scope?.type === 'graph' && parentId !== context.page.id ? [] : context.filters.clauses);
    const groupColumnIds = context.kind === 'table' ? [...new Set(context.filters.groupBy.filter((id) => id === 'page_title' || context.columns.some((column) => column.id === id && !['flow', 'relation', 'extract_as', 'formula'].includes(String(column.type)))))] : [];
    const board = object(context.view.board);
    const selectColumn = context.kind === 'board' ? board.selectColumnId === undefined ? context.columns.find((column) => column.type === 'select')
      : context.columns.find((column) => column.id === board.selectColumnId && column.type === 'select') : undefined;
    const heatmap = object(context.view.heatmap);
    const dateColumn = ['calendar', 'timeline'].includes(context.kind) || scope?.type === 'calendar' ? context.view.dateColumnId === undefined ? context.columns.find((column) => column.type === 'date')
      : context.columns.find((column) => column.id === context.view.dateColumnId && column.type === 'date')
      : context.kind === 'heatmap' || scope?.type === 'heatmap' ? context.columns.find((column) => column.id === heatmap.dateColumnId && column.type === 'date') : undefined;
    const checkboxColumn = context.kind === 'heatmap' || scope?.type === 'heatmap'
      ? context.columns.find((column) => column.id === heatmap.checkboxColumnId && column.type === 'checkbox') : undefined;
    const joins: string[] = [], joinValues: unknown[] = [], projected: string[] = [];
    if (selectColumn) {
      joins.push('LEFT JOIN page_columns_values board_value ON board_value.page_id = candidate.id AND board_value.page_column_id = ?'); joinValues.push(selectColumn.id);
      const options = stringList((Array.isArray(selectColumn.data?.options) ? selectColumn.data.options : []).map((option) => object(option).id));
      const value = cellValueSql('board_value');
      projected.push(`CASE WHEN ${cellTypeSql('board_value')} = 'text' AND ${value} IN (${options.length ? options.map(() => '?').join(',') : 'NULL'}) THEN ${value} ELSE '${PAGE_VIEW_UNASSIGNED}' END AS board_key`);
    }
    if (dateColumn) {
      joins.push('LEFT JOIN page_columns_values date_value ON date_value.page_id = candidate.id AND date_value.page_column_id = ?'); joinValues.push(dateColumn.id);
      const interval = cellDateIntervalSql('date_value');
      projected.push(`${interval.start} AS date_start_ms`, `${interval.end} AS date_end_ms`);
    }
    if (checkboxColumn) {
      joins.push('LEFT JOIN page_columns_values heatmap_checkbox ON heatmap_checkbox.page_id = candidate.id AND heatmap_checkbox.page_column_id = ?');
      joinValues.push(checkboxColumn.id);
      projected.push(`CASE WHEN ${cellTypeSql('heatmap_checkbox')}='true' THEN 1 ELSE 0 END AS heatmap_checked`);
    }
    groupColumnIds.forEach((id, index) => {
      const alias = `group_value_${index}`;
      if (id !== 'page_title') { joins.push(`LEFT JOIN page_columns_values ${alias} ON ${alias}.page_id = candidate.id AND ${alias}.page_column_id = ?`); joinValues.push(id); }
      projected.push(`${id === 'page_title' ? titleToken() : groupToken(alias)} AS group_${index}`);
    });
    const options = selectColumn && Array.isArray(selectColumn.data?.options) ? selectColumn.data.options.map((option) => object(option).id).filter((id): id is string => typeof id === 'string') : [];
    const natural = viewId === QUERY_FALLBACK_VIEW || parentId !== context.page.id;
    const rank = natural ? 'candidate.id' : 'row_order.rank';
    if (!natural) { joins.unshift('JOIN page_view_row_order row_order ON row_order.edge_id = child_edge.id AND row_order.view_id = ?'); joinValues.unshift(viewId); }
    const rowGuard = correlatedPageReadGuard('candidate.id', context.userId);
    const parentGuard = accessGuard('page', parentId, context.userId, 'read', 'subpages');
    const select = [`candidate.id`, `candidate.title`, `${rank} AS rank_key`, ...projected].join(',');
    return { sql: { text: `SELECT ${select} FROM pages candidate JOIN page_edges child_edge ON child_edge.child_id = candidate.id
      ${joins.join('\n')} ${filters.joins.text}
      WHERE child_edge.parent_id = ? AND candidate.deleted_at IS NULL AND ${parentGuard.text} AND ${rowGuard.text} AND ${filters.where.text}`,
      values: [...options, ...joinValues, ...filters.joins.values, parentId, ...parentGuard.values, ...rowGuard.values, ...filters.where.values] }, groupColumnIds,
      ...(selectColumn && { selectColumn }), ...(dateColumn && { dateColumn }), ...(checkboxColumn && { checkboxColumn }) };
  }

  private scopeCondition(base: BaseQuery, scope: PageViewQueryScope): QuerySqlFragment {
    if (scope.type === 'board') {
      if (!base.selectColumn) throw new PageViewQueryError(400, 'Escolha uma coluna select válida');
      return { text: 'board_key = ?', values: [scope.optionId] };
    }
    if (scope.type === 'calendar') {
      if (!base.dateColumn) throw new PageViewQueryError(400, 'Escolha uma coluna de data válida');
      const from = scope.day ?? scope.from, to = scope.day ?? scope.to;
      return { text: 'date_start_ms <= ? AND date_end_ms >= ?', values: [dateBound(to, true), dateBound(from, false)] };
    }
    if (scope.type === 'heatmap') {
      if (!base.dateColumn || !base.checkboxColumn) throw new PageViewQueryError(400, 'Escolha colunas válidas para o Mapa de calor');
      const from = scope.day ?? scope.from, to = scope.day ?? scope.to;
      return { text: 'date_start_ms = date_end_ms AND date_start_ms >= ? AND date_start_ms <= ?', values: [dateBound(from, false), dateBound(to, true)] };
    }
    if (scope.type === 'group') {
      if (scope.path.length !== base.groupColumnIds.length || scope.path.some((entry, index) => entry.columnId !== base.groupColumnIds[index])) throw new PageViewQueryError(400, 'Grupo incompatível com a consulta');
      return { text: scope.path.map((entry, index) => entry.value === null ? `group_${index} IS NULL` : `group_${index} = ?`).join(' AND ') || '1', values: scope.path.flatMap((entry) => entry.value === null ? [] : [entry.value]) };
    }
    return { text: '1', values: [] };
  }
  private cursorContext(context: QueryContext, scope: PageViewQueryScope): QueryCursorContext {
    return { queryKey: context.queryKey, userId: context.userId, orderRevision: context.orderRevision, scopeKey: pageViewScopeKey(scope) };
  }
  private datasetSql(selected: string): string {
    return `WITH selected AS (${selected}) SELECT selected.id, selected.title, selected.rank_key, selected.window_key,
      COALESCE(json_group_object(cell.page_column_id, json_object('row_id',cell.id,'row_data',cell.data,'column_name',NULL,'column_type',NULL,'column_data',NULL)) FILTER (WHERE column_definition.id IS NOT NULL), '{}') AS page_columns
      FROM selected LEFT JOIN page_columns_values cell ON cell.page_id = selected.id
      LEFT JOIN page_columns column_definition ON column_definition.id = cell.page_column_id AND column_definition.deleted_at IS NULL
      GROUP BY selected.window_key, selected.id, selected.title, selected.rank_key ORDER BY selected.window_key, selected.rank_key, selected.id`;
  }
  private toDataset(row: SqlRow): QueryDatasetRow { return { page_id: row.id, page_title: row.title, page_columns: row.page_columns ? JSON.parse(row.page_columns) as QueryDatasetRow['page_columns'] : {} }; }
  private async readCalendarPreview(context: QueryContext, base: BaseQuery, scope: Extract<PageViewQueryScope, { type: 'calendar' }>, limit: number, total: number): Promise<PageViewQueryWindow> {
    const key = pageViewScopeKey(scope), condition = this.scopeCondition(base, scope);
    // A range belongs to its first overlapping day for budgeting, so one page
    // consumes one slot even when the Calendar displays it on several days.
    // Interleaving day ordinals also redistributes unused quotas automatically.
    const selected = `WITH filtered AS (${base.sql.text}), assigned AS (
      SELECT id,title,rank_key,CASE WHEN date_start_ms < ? THEN ? ELSE strftime('%Y-%m-%d',date_start_ms/1000,'unixepoch') END AS preview_day
      FROM filtered WHERE ${condition.text}
    ), ranked AS (SELECT id,title,rank_key,preview_day,ROW_NUMBER() OVER (PARTITION BY preview_day ORDER BY rank_key,id) AS day_ordinal FROM assigned)
      SELECT id,title,rank_key,? AS window_key FROM ranked ORDER BY day_ordinal,preview_day,rank_key,id LIMIT ?`;
    const rows = await this.execute<SqlRow>({ text: this.datasetSql(selected), values: [...base.sql.values, utcDay(scope.from), scope.from.slice(0, 10), ...condition.values, key, limit] });
    return { key, scope, rows: rows.map((row) => this.toDataset(row)), total, nextCursor: null, previousCursor: null };
  }
  private async readWindow(context: QueryContext, base: BaseQuery, scope: PageViewQueryScope, total: number, limit: number, request: PageViewQueryRequest): Promise<PageViewQueryWindow> {
    const key = pageViewScopeKey(scope), condition = this.scopeCondition(base, scope), where = [condition.text], values = [...condition.values];
    const cursorContext = this.cursorContext(context, scope), previous = request.direction === 'previous';
    if (request.cursor) {
      const position = this.cursor.decode(request.cursor, cursorContext);
      const operator = previous ? '<' : '>';
      where.push(`(rank_key ${operator} ? OR rank_key = ? AND id ${operator} ?)`); values.push(position.rank, position.rank, position.id);
    } else if (request.anchorId) {
      const [anchor] = await this.execute<Pick<SqlRow, 'id' | 'rank_key'>>({ text: `WITH filtered AS (${base.sql.text}) SELECT id,rank_key FROM filtered WHERE id = ? AND ${condition.text}`, values: [...base.sql.values, request.anchorId, ...condition.values] });
      if (anchor) { where.push('(rank_key > ? OR rank_key = ? AND id >= ?)'); values.push(anchor.rank_key, anchor.rank_key, anchor.id); }
    }
    const positions = await this.execute<Pick<SqlRow, 'id' | 'rank_key'>>({
      text: `SELECT id,rank_key FROM (${base.sql.text}) WHERE ${where.join(' AND ')} ORDER BY rank_key ${previous ? 'DESC' : 'ASC'},id ${previous ? 'DESC' : 'ASC'} LIMIT ?`,
      values: [...base.sql.values, ...values, limit + 1],
    });
    const extra = positions.length > limit, selectedPositions = positions.slice(0, limit);
    // Only the IDs/ranks include a sentinel. Full cells belong exclusively to
    // the visible slice, and the aggregate restores order for backward paging.
    // Re-evaluate ACL, filters and scope in the hydration statement: membership
    // changes can happen between these two reads, so membership is re-evaluated.
    const selected = `SELECT id,title,rank_key,? AS window_key FROM (${base.sql.text})
      WHERE id IN (${selectedPositions.map(() => '?').join(',')}) AND ${where.join(' AND ')}`;
    const rows = selectedPositions.length ? await this.execute<SqlRow>({ text: this.datasetSql(selected),
      values: [key, ...base.sql.values, ...selectedPositions.map((position) => position.id), ...values] }) : [];
    const first = rows[0], last = rows[rows.length - 1];
    return { key, scope, rows: rows.map((row) => this.toDataset(row)), total,
      nextCursor: last && (previous ? Boolean(request.cursor) : extra) ? this.cursor.encode(cursorContext, { rank: last.rank_key, id: last.id }) : null,
      previousCursor: first && (previous ? extra : Boolean(request.cursor || request.anchorId)) ? this.cursor.encode(cursorContext, { rank: first.rank_key, id: first.id }) : null };
  }
  private allocate(groups: readonly PageViewQueryGroup[], limit: number, scope: (group: PageViewQueryGroup) => PageViewQueryScope): AllocatedStream[] {
    const streams = groups.filter((group) => group.total > 0).map((group) => ({ scope: scope(group), total: group.total, quota: 0 }));
    let remaining = limit;
    while (remaining && streams.some((stream) => stream.quota < stream.total)) {
      for (const stream of streams) { if (!remaining) break; if (stream.quota < stream.total) { stream.quota += 1; remaining -= 1; } }
    }
    return streams.filter((stream) => stream.quota > 0);
  }
  private async readAllocated(context: QueryContext, base: BaseQuery, streams: AllocatedStream[]): Promise<PageViewQueryWindow[]> {
    if (!streams.length) return [];
    const values: unknown[] = [...base.sql.values], selects: string[] = [];
    for (const stream of streams) {
      const condition = this.scopeCondition(base, stream.scope), key = pageViewScopeKey(stream.scope);
      selects.push(`SELECT * FROM (SELECT id,title,rank_key,? AS window_key FROM filtered WHERE ${condition.text} ORDER BY rank_key,id LIMIT ?)`);
      values.push(key, ...condition.values, stream.quota);
    }
    const selected = `WITH filtered AS (${base.sql.text}) ${selects.join(' UNION ALL ')}`;
    const rows = await this.execute<SqlRow>({ text: this.datasetSql(selected), values });
    return streams.map((stream) => {
      const key = pageViewScopeKey(stream.scope), found = rows.filter((row) => row.window_key === key), last = found[found.length - 1];
      return { key, scope: stream.scope, rows: found.map((row) => this.toDataset(row)), total: stream.total, previousCursor: null,
        nextCursor: last && stream.total > found.length ? this.cursor.encode(this.cursorContext(context, stream.scope), { rank: last.rank_key, id: last.id }) : null };
    });
  }
  private attachWindows(groups: PageViewQueryGroup[], windows: PageViewQueryWindow[]): void {
    for (const group of groups) {
      const window = windows.find((entry) => entry.key === group.key);
      if (window) { group.windowKey = window.key; group.nextCursor = window.nextCursor; }
      if (group.children) this.attachWindows(group.children, windows);
    }
  }
  private seedEmptyWindows(context: QueryContext, leaves: PageViewQueryGroup[], windows: PageViewQueryWindow[]): void {
    for (const group of leaves) {
      if (windows.some((window) => window.key === group.key)) continue;
      const scope: PageViewQueryScope = context.kind === 'board' ? { type: 'board', optionId: group.value ?? PAGE_VIEW_UNASSIGNED } : { type: 'group', path: group.path };
      windows.push({ key: group.key, scope, rows: [], total: group.total, previousCursor: null,
        nextCursor: group.total ? this.cursor.encode(this.cursorContext(context, scope), { rank: '', id: '' }) : null });
    }
  }
  private async boardGroups(base: BaseQuery, context: QueryContext): Promise<PageViewQueryGroup[]> {
    const counts = await this.execute<{ board_key: string; total: number }>({ text: `WITH filtered AS (${base.sql.text}) SELECT board_key,COUNT(*) AS total FROM filtered GROUP BY board_key`, values: base.sql.values });
    const options = Array.isArray(base.selectColumn?.data?.options) ? base.selectColumn.data.options.map(object).filter((entry) => typeof entry.id === 'string') : [];
    const natural = [...options.map((entry) => String(entry.id)), PAGE_VIEW_UNASSIGNED], available = new Set(natural);
    const order = [...new Set([...stringList(object(context.view.board).optionOrder).filter((key) => available.has(key)), ...natural])];
    return order.map((id) => {
      const option = options.find((entry) => entry.id === id), scope: PageViewQueryScope = { type: 'board', optionId: id };
      return { key: pageViewScopeKey(scope), value: id, columnId: base.selectColumn!.id, path: [], label: typeof option?.value === 'string' ? option.value : 'Sem valor',
        color: typeof option?.color === 'string' ? option.color : 'grey', total: counts.find((entry) => entry.board_key === id)?.total ?? 0 };
    });
  }
  private async tableGroups(base: BaseQuery, context: QueryContext, token?: string | null): Promise<{ groups: PageViewQueryGroup[]; leaves: PageViewQueryGroup[]; nextCursor: string | null }> {
    const groupFields = base.groupColumnIds.map((_, index) => `group_${index}`), groupJson = `json_array(${groupFields.join(',')})`;
    const cursorContext = { ...this.cursorContext(context, { type: 'root' }), scopeKey: 'table-groups' };
    const position = token ? this.cursor.decode(token, cursorContext, 'groups') : null;
    const rows = await this.execute<SqlGroup>({ text: `WITH filtered AS (${base.sql.text}), grouped AS (SELECT ${groupJson} AS group_json,COUNT(*) AS total,MIN(rank_key) AS first_rank,MIN(id) AS first_id FROM filtered GROUP BY ${groupFields.join(',')})
      SELECT * FROM grouped ${position ? 'WHERE first_rank > ? OR first_rank = ? AND group_json > ?' : ''} ORDER BY first_rank,group_json LIMIT ?`,
      values: [...base.sql.values, ...(position ? [position.rank, position.rank, position.id] : []), PAGE_VIEW_BATCH_SIZE + 1] });
    const visible = rows.slice(0, PAGE_VIEW_BATCH_SIZE), roots: PageViewQueryGroup[] = [], leaves: PageViewQueryGroup[] = [], all = new Map<string, PageViewQueryGroup>();
    for (const row of visible) {
      const groupValues = JSON.parse(row.group_json) as (string | null)[], path: QueryGroupValue[] = [];
      let siblings = roots;
      groupValues.forEach((value, depth) => {
        const columnId = base.groupColumnIds[depth]!;
        path.push({ columnId, value });
        const key = pageViewScopeKey({ type: 'group', path: [...path] });
        let node = all.get(key);
        if (!node) { node = { key, columnId, value, path: [...path], label: this.groupLabel(context, columnId, value), total: 0, ...(depth + 1 < groupValues.length && { children: [] }) }; siblings.push(node); all.set(key, node); }
        node.total += row.total;
        if (depth + 1 === groupValues.length) leaves.push(node);
        siblings = node.children ?? [];
      });
    }
    // Ancestor counts include leaves whose headers were not materialized yet.
    const ancestors = [...all.values()].filter((node) => node.children);
    if (ancestors.length) {
      const selects: string[] = [], values: unknown[] = [...base.sql.values];
      for (const node of ancestors) {
        const conditions = node.path.map((entry, index) => entry.value === null ? `group_${index} IS NULL` : `group_${index} = ?`);
        selects.push(`SELECT ? AS key,COUNT(*) AS total FROM filtered WHERE ${conditions.join(' AND ')}`);
        values.push(node.key, ...node.path.flatMap((entry) => entry.value === null ? [] : [entry.value]));
      }
      const counts = await this.execute<{ key: string; total: number }>({ text: `WITH filtered AS (${base.sql.text}) ${selects.join(' UNION ALL ')}`, values });
      for (const count of counts) { const node = all.get(count.key); if (node) node.total = count.total; }
    }
    const last = visible[visible.length - 1];
    return { groups: roots, leaves, nextCursor: rows.length > PAGE_VIEW_BATCH_SIZE && last ? this.cursor.encode(cursorContext, { rank: last.first_rank, id: last.group_json }, 'groups') : null };
  }
  private groupLabel(context: QueryContext, columnId: string, token: string | null): string {
    if (token == null) return 'Sem valor';
    const raw = token.slice(token.indexOf(':') + 1), column = context.columns.find((entry) => entry.id === columnId);
    if (column?.type === 'select') return (Array.isArray(column.data?.options) ? column.data.options : []).map(object).find((option) => option.id === raw)?.value as string ?? 'Sem valor';
    if (column?.type === 'checkbox') return raw === 'true' ? 'Sim' : 'Não';
    if (column?.type === 'numeric') {
      if (!token.startsWith('number:') || !Number.isFinite(Number(raw))) return 'Sem valor';
      const number = Number(raw);
      if (column.data?.format === 'currency') {
        const digits = String(Math.round(number)).replace(/\D/g, '').slice(0, 15);
        return digits ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(digits) / 100) : 'Sem valor';
      }
      if (column.data?.format === 'percentage') {
        const digits = String(number).replace(/\D/g, '').slice(0, 3);
        return digits ? `${Number(digits)}%` : 'Sem valor';
      }
      return String(number);
    }
    if (token.startsWith('boolean:')) return raw === 'true' ? '✓' : '✕';
    return raw || 'Sem valor';
  }

  private async enrichProjection(projection: PageViewQueryProjection, context: QueryContext): Promise<PageViewQueryProjection> {
    const rows = [...new Map(projection.windows.flatMap((window) => window.rows).map((row) => [row.page_id, row] as const)).values()];
    if (!rows.length) return projection;

    const relationColumns = context.columns.filter((column) => column.type === 'relation');
    const targetIds: string[] = [];
    const decoded = new Map<string, string[]>();
    for (const row of rows) {
      for (const column of relationColumns) {
        const cell = row.page_columns[column.id];
        if (!cell?.row_data) continue;
        try {
          const value = (JSON.parse(cell.row_data) as { value?: unknown }).value;
          const ids = Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
          decoded.set(`${row.page_id}:${column.id}`, ids);
          targetIds.push(...ids);
        } catch {
          decoded.set(`${row.page_id}:${column.id}`, []);
        }
      }
    }
    const relationTargets = await this.relations.resolveVisibleTargets(targetIds, context.userId);
    for (const row of rows) {
      for (const column of relationColumns) {
        const cell = row.page_columns[column.id];
        if (!cell) continue;
        const visible = (decoded.get(`${row.page_id}:${column.id}`) ?? []).filter((id) => relationTargets[id]);
        cell.row_data = JSON.stringify({ value: visible });
      }
    }

    for (const column of context.columns.filter((candidate) => candidate.type === 'extract_as' && candidate.data?.rollupResult)) {
      const values = await this.relations.resolveRollupValues({ data: column.data as Schema.PageColumnData }, rows.map((row) => row.page_id), context.userId);
      for (const row of rows) {
        const value = values[row.page_id];
        row.page_columns[column.id] = {
          row_id: null,
          row_data: JSON.stringify({ value }),
          column_name: column.name,
          column_type: 'extract_as',
          column_data: JSON.stringify(column.data),
        };
      }
    }
    if (rows.length && context.columns.some(column => column.type === 'formula')) {
      const columns = context.columns.filter(column => column.type === 'formula');
      const calculated = await formulas.evaluateColumns(context.page.id, columns.map(column => ({id: column.id, source: (column.data as Schema.PageColumnData)?.formula?.source ?? ''})), rows.map(row => row.page_id), context.userId);
      for (const column of columns) {
        const results = calculated[column.id]!;
        for (const row of rows) {
          const result = results[row.page_id];
          const value = result?.ok ? result.value : {kind:'formula-error',message:result?.error.message ?? 'Fórmula indisponível'};
          row.page_columns[column.id] = {row_id:null,row_data:JSON.stringify({value}),column_name:column.name,column_type:'formula',column_data:JSON.stringify(column.data)};
        }
      }
    }
    return { ...projection, ...(Object.keys(relationTargets).length && { relationTargets }) };
  }

  private async heatmapCounts(base: BaseQuery, from: string, to: string): Promise<{ days: Record<string, { total: number; checked: number }>; ignoredRanges: number }> {
    const start = utcDay(from), end = utcDay(to);
    const dayCount = Math.floor((end - start) / 86_400_000) + 1;
    if (!Number.isFinite(dayCount) || dayCount < 1 || dayCount > 366) {
      throw new PageViewQueryError(400, 'O Mapa de calor aceita períodos de até 366 dias');
    }
    const rows = await this.execute<SqlDay>({
      text: `WITH RECURSIVE filtered AS (${base.sql.text}), days(day,day_ms) AS (
          SELECT ?,? UNION ALL SELECT date(day,'+1 day'),day_ms+86400000 FROM days WHERE day < ?
        )
        SELECT days.day,COUNT(filtered.id) AS total,COALESCE(SUM(filtered.heatmap_checked),0) AS checked
        FROM days LEFT JOIN filtered ON filtered.date_start_ms=filtered.date_end_ms
          AND filtered.date_start_ms>=days.day_ms AND filtered.date_start_ms<=days.day_ms+86399999
        GROUP BY days.day ORDER BY days.day`,
      values: [...base.sql.values, from, start, to],
    });
    const [ignored] = await this.execute<{ total: number }>({
      text: `WITH filtered AS (${base.sql.text}) SELECT COUNT(*) AS total FROM filtered
        WHERE date_start_ms IS NOT NULL AND date_end_ms IS NOT NULL AND date_start_ms<>date_end_ms
          AND date_start_ms<=? AND date_end_ms>=?`,
      values: [...base.sql.values, end + 86_400_000 - 1, start],
    });
    return {
      days: Object.fromEntries(rows.map((row) => [row.day, { total: row.total, checked: row.checked ?? 0 }])),
      ignoredRanges: ignored?.total ?? 0,
    };
  }

  private async calendarCounts(base: BaseQuery, from: string, to: string): Promise<Record<string, number>> {
    const rows = await this.execute<SqlDay>({ text: `WITH RECURSIVE filtered AS (${base.sql.text}), days(day,day_ms) AS (SELECT ?,? UNION ALL SELECT date(day,'+1 day'),day_ms+86400000 FROM days WHERE day < ?)
      SELECT days.day,COUNT(filtered.id) AS total FROM days LEFT JOIN filtered ON filtered.date_start_ms <= days.day_ms+86399999 AND filtered.date_end_ms >= days.day_ms GROUP BY days.day ORDER BY days.day`,
      values: [...base.sql.values, from.slice(0, 10), utcDay(from), to.slice(0, 10)] });
    return Object.fromEntries(rows.map((row) => [row.day, row.total]));
  }
}

export default new PageViewQueryStore();
