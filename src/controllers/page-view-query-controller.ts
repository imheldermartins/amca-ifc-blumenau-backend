import store, { PageViewQueryStore, QUERY_FALLBACK_VIEW } from '@/repositories/page-view-query-repository';
import { PageViewQueryError } from '@/repositories/page-view-query-cursor';
import { isUlid } from '@/utils/ulid';
import type { PageViewQueryRequest, PageViewQueryScope, QueryFilters, QueryViewKind } from '@/services/pages/views/page-view-query-contract';

function record(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function keys(value: Record<string, unknown>, allowed: string[]): boolean { return Object.keys(value).every((key) => allowed.includes(key)); }
function date(value: unknown): value is string { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value; }
function fail(): never { throw new PageViewQueryError(400, 'Consulta de visualização inválida'); }

export function parsePageViewQueryRequest(raw: unknown): PageViewQueryRequest {
  if (!record(raw) || !keys(raw, ['view', 'filters', 'scope', 'cursor', 'groupCursor', 'direction', 'limit', 'visibleGroupKeys', 'anchorId', 'metadataOnly'])) fail();
  if (raw.view !== undefined && !['table', 'grid', 'board', 'calendar', 'timeline', 'graph', 'form'].includes(String(raw.view))) fail();
  if (raw.metadataOnly !== undefined && typeof raw.metadataOnly !== 'boolean') fail();
  if (raw.limit !== undefined && (typeof raw.limit !== 'number' || !Number.isInteger(raw.limit) || raw.limit < 1 || raw.limit > 50)) fail();
  if (raw.direction !== undefined && !['next', 'previous'].includes(String(raw.direction))) fail();
  for (const key of ['cursor', 'groupCursor']) if (raw[key] !== undefined && raw[key] !== null && (typeof raw[key] !== 'string' || raw[key].length > 4096)) fail();
  if (raw.anchorId !== undefined && !isUlid(raw.anchorId)) fail();
  if (raw.visibleGroupKeys !== undefined && (!Array.isArray(raw.visibleGroupKeys) || raw.visibleGroupKeys.length > 500 || raw.visibleGroupKeys.some((key) => typeof key !== 'string' || key.length > 4096))) fail();
  let filters: QueryFilters | undefined;
  if (raw.filters !== undefined) {
    const value = raw.filters;
    if (!record(value) || !keys(value, ['version', 'clauses', 'groupBy', 'passthrough', 'updatedAt']) || value.version !== 2
      || !Array.isArray(value.clauses) || value.clauses.length > 100 || !Array.isArray(value.groupBy) || value.groupBy.length > 20
      || value.groupBy.some((id) => typeof id !== 'string' || id.length > 100)) fail();
    for (const clause of value.clauses) {
      if (!record(clause) || !keys(clause, ['columnId', 'condition', 'values']) || typeof clause.columnId !== 'string' || clause.columnId.length > 100
        || !['equals', 'contains', 'greaterThan', 'lessThan', 'between'].includes(String(clause.condition)) || !Array.isArray(clause.values)
        || clause.values.length > 500 || clause.values.some((operand) => typeof operand !== 'string' || operand.length > 4096)) fail();
    }
    filters = { version: 2, clauses: value.clauses as QueryFilters['clauses'], groupBy: value.groupBy as string[] };
  }
  let scope: PageViewQueryScope | undefined;
  if (raw.scope !== undefined) {
    const value = raw.scope;
    if (!record(value) || typeof value.type !== 'string') fail();
    switch (value.type) {
      case 'root': if (!keys(value, ['type'])) fail(); scope = { type: 'root' }; break;
      case 'board':
        if (!keys(value, ['type', 'optionId']) || value.optionId !== '__unassigned__' && !isUlid(value.optionId)) fail();
        scope = { type: 'board', optionId: value.optionId as string }; break;
      case 'group':
        if (!keys(value, ['type', 'path']) || !Array.isArray(value.path) || !value.path.length || value.path.length > 20
          || value.path.some((entry) => !record(entry) || !keys(entry, ['columnId', 'value']) || entry.columnId !== 'page_title' && !isUlid(entry.columnId)
            || entry.value !== null && (typeof entry.value !== 'string' || entry.value.length > 4096))) fail();
        scope = { type: 'group', path: value.path as Extract<PageViewQueryScope, { type: 'group' }>['path'] }; break;
      case 'calendar':
        if (!keys(value, ['type', 'from', 'to', 'day']) || !date(value.from) || !date(value.to)
          || value.to < value.from || Date.parse(value.to) - Date.parse(value.from) > 366 * 86_400_000
          || value.day !== undefined && (!date(value.day) || value.day < value.from || value.day > value.to)) fail();
        scope = { type: 'calendar', from: value.from, to: value.to, ...(value.day !== undefined && { day: value.day as string }) }; break;
      case 'graph':
        if (!keys(value, ['type', 'parentId']) || !isUlid(value.parentId)) fail(); scope = { type: 'graph', parentId: value.parentId }; break;
      default: fail();
    }
  }
  return { ...(raw.view !== undefined && { view: raw.view as QueryViewKind }), ...(filters && { filters }), ...(scope && { scope }), ...(raw.cursor !== undefined && { cursor: raw.cursor as string | null }),
    ...(raw.groupCursor !== undefined && { groupCursor: raw.groupCursor as string | null }), ...(raw.direction !== undefined && { direction: raw.direction as 'next' | 'previous' }),
    ...(raw.limit !== undefined && { limit: raw.limit as number }), ...(raw.visibleGroupKeys !== undefined && { visibleGroupKeys: raw.visibleGroupKeys as string[] }),
    ...(raw.anchorId !== undefined && { anchorId: raw.anchorId as string }), ...(raw.metadataOnly !== undefined && { metadataOnly: raw.metadataOnly as boolean }) };
}

type QueryResult<T> = { ok: true; data: T } | { ok: false; status: 400 | 404 | 409 | 500; message: string; code?: string };
export class PageViewQueryController {
  constructor(private readonly queries: PageViewQueryStore = store) {}
  async metadata(pageId: string, userId: string): Promise<QueryResult<Awaited<ReturnType<PageViewQueryStore['metadata']>>>> {
    return this.run(async () => { if (!isUlid(pageId) || !isUlid(userId)) fail(); return this.queries.metadata(pageId, userId); });
  }
  async query(pageId: string, viewId: string, userId: string, input: unknown): Promise<QueryResult<Awaited<ReturnType<PageViewQueryStore['query']>>>> {
    return this.run(async () => { if (!isUlid(pageId) || !isUlid(userId) || viewId !== QUERY_FALLBACK_VIEW && !isUlid(viewId)) fail();
      return this.queries.query(pageId, viewId, userId, parsePageViewQueryRequest(input)); });
  }
  private async run<T>(operation: () => Promise<T>): Promise<QueryResult<T>> {
    try { return { ok: true, data: await operation() }; }
    catch (error) {
      if (error instanceof PageViewQueryError) return { ok: false, status: error.status, message: error.message, ...(error.code && { code: error.code }) };
      console.error('[cubs:page-view-query] Falha na leitura da projeção', error);
      return { ok: false, status: 500, message: 'Não foi possível carregar a visualização' };
    }
  }
}
export default new PageViewQueryController();
