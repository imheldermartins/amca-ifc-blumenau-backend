import {isJsonRecord} from '@/services/pages/views/page-view-parsers';

/** Legacy order remains in storage until imported; migrated snapshots only carry a revision. */
export function sanitizeViewSnapshot(data: unknown): unknown {
  if (!isJsonRecord(data)) return data;
  return Object.fromEntries(Object.entries(data).map(([key, value]) => {
    if (!isJsonRecord(value) || !isJsonRecord(value.rowOrder) || value.rowOrder.version !== 2) return [key, value];
    const {orderedRows: _legacyOrder, ...preferences} = value;
    return [key, preferences];
  }));
}

export function stripPageQueryInternals<T extends {data: unknown}>(page: T): T {
  const {title_search: _search, projection_version: _version, dataset_revision: _revision, ...publicPage} =
    page as T & {title_search?: unknown; projection_version?: unknown; dataset_revision?: unknown};
  return {...publicPage, data: sanitizeViewSnapshot(page.data)} as T;
}
