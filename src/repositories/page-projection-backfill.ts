import {rqlite} from '@/db/client-db';
import {ensurePageViewRowOrder, ROW_ORDER_BACKFILL_BATCH} from '@/repositories/page-view-row-order';
import {isActivePageView, isJsonRecord, isUlid} from '@/services/pages/views/page-view-parsers';

export async function pendingDatabaseViewOrderCount(): Promise<number> {
  const [views] = await rqlite<{total: number}>([
    [`SELECT COUNT(*) AS total FROM pages parent, json_each(CASE WHEN json_valid(parent.data) THEN parent.data ELSE '{}' END) view
      WHERE parent.deleted_at IS NULL AND view.type = 'object'
       AND length(view.key)=26 AND upper(view.key) NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'
       AND json_extract(CASE WHEN view.type = 'object' THEN view.value ELSE '{}' END, '$.view') IN ('table','grid','board','calendar','timeline','graph','form')
       AND json_extract(CASE WHEN view.type = 'object' THEN view.value ELSE '{}' END, '$.deletedAt') IS NULL
       AND COALESCE(json_extract(CASE WHEN view.type = 'object' THEN view.value ELSE '{}' END, '$.rowOrder.version'), 0) <> 2`],
  ], 'query');
  return views?.[0]?.total ?? 0;
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
