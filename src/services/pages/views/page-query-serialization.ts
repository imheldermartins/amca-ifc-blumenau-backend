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
  return {...page, data: sanitizeViewSnapshot(page.data)};
}
