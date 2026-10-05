import {rqlite} from '@/db/client-db';
import {CELL_PROJECTION_FIELDS, cellProjectionValues, titleValueProjection} from '@/repositories/page-value-projection';
import {ensurePageViewRowOrder, ROW_ORDER_BACKFILL_BATCH} from '@/repositories/page-view-row-order';
import {isActivePageView, isJsonRecord, isUlid} from '@/services/pages/views/page-view-parsers';

export async function pendingDatabaseProjectionCounts() {
  const [pages, cells, views] = await rqlite<{total: number}>([
    ['SELECT COUNT(*) AS total FROM pages WHERE projection_version = 0'],
    ['SELECT COUNT(*) AS total FROM page_columns_values WHERE projection_version = 0'],
    [`SELECT COUNT(*) AS total FROM pages parent, json_each(CASE WHEN json_valid(parent.data) THEN parent.data ELSE '{}' END) view
      WHERE parent.deleted_at IS NULL AND view.type = 'object'
       AND length(view.key)=26 AND upper(view.key) NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'
       AND json_extract(CASE WHEN view.type = 'object' THEN view.value ELSE '{}' END, '$.view') IN ('table','grid','board','calendar','timeline','graph','form')
       AND json_extract(CASE WHEN view.type = 'object' THEN view.value ELSE '{}' END, '$.deletedAt') IS NULL
       AND COALESCE(json_extract(CASE WHEN view.type = 'object' THEN view.value ELSE '{}' END, '$.rowOrder.version'), 0) <> 2`],
  ], 'query');
  return {pages: pages?.[0]?.total ?? 0, cells: cells?.[0]?.total ?? 0, views: views?.[0]?.total ?? 0};
}

/** Conditional updates prevent a backfill from replacing a concurrently edited canonical value. */
export async function backfillDatabaseValueProjections(): Promise<{pages: number; cells: number}> {
  let pages = 0, cells = 0;
  for (;;) {
    const [batch] = await rqlite<{id: string; title: string | null}>([[
      'SELECT id, title FROM pages WHERE projection_version = 0 ORDER BY id LIMIT ?', ROW_ORDER_BACKFILL_BATCH,
    ]], 'query');
    if (!batch?.length) break;
    const results = await rqlite(batch.map((page) => [
      'UPDATE pages SET title_search = ?, projection_version = 1 WHERE id = ? AND title IS ? AND projection_version = 0',
      titleValueProjection(page.title).title_search, page.id, page.title,
    ]), 'execute', {transaction: true});
    pages += results.filter(Boolean).length;
  }
  for (;;) {
    const [batch] = await rqlite<{id: string; data: string | null}>([[
      'SELECT id, data FROM page_columns_values WHERE projection_version = 0 ORDER BY id LIMIT ?', ROW_ORDER_BACKFILL_BATCH,
    ]], 'query');
    if (!batch?.length) break;
    const results = await rqlite(batch.map((cell) => [
      `UPDATE page_columns_values SET ${CELL_PROJECTION_FIELDS.map((field) => `${field} = ?`).join(', ')}
       WHERE id = ? AND data IS ? AND projection_version = 0`,
      ...cellProjectionValues(cell.data), cell.id, cell.data,
    ]), 'execute', {transaction: true});
    cells += results.filter(Boolean).length;
  }
  return {pages, cells};
}

export async function backfillDatabaseViewOrders(): Promise<number> {
  let count = 0, cursor = '';
  for (;;) {
    const [batch] = await rqlite<{id: string; data: string}>([[
      'SELECT id, data FROM pages WHERE id > ? AND deleted_at IS NULL ORDER BY id LIMIT ?', cursor, ROW_ORDER_BACKFILL_BATCH,
    ]], 'query');
    if (!batch?.length) break;
    for (const page of batch) {
      let data: unknown;
      try { data = typeof page.data === 'string' ? JSON.parse(page.data) : page.data; } catch { continue; }
      if (!isJsonRecord(data)) continue;
      for (const [viewId, view] of Object.entries(data)) {
        if (!isUlid(viewId) || !isActivePageView(view)) continue;
        const migrated = isJsonRecord(view.rowOrder) && view.rowOrder.version === 2;
        await ensurePageViewRowOrder(page.id, viewId);
        if (!migrated) count++;
      }
    }
    cursor = batch.at(-1)!.id;
  }
  return count;
}
