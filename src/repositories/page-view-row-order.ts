import {generateKeyBetween, generateNKeysBetween} from 'fractional-indexing';
import {ulid} from 'ulid';
import {rqlite} from '@/db/client-db';
import {isActivePageView, isJsonRecord, isUlid} from '@/services/pages/views/page-view-parsers';

export const PAGE_ROW_ORDER_VERSION = 2;
export const ROW_ORDER_BACKFILL_BATCH = 500;
export interface PageViewOrderedRow {row_id: string; rank: string}
const locks = new Map<string, Promise<unknown>>();

/** Serialize local order operations; SQL guards still protect the commit. */
export async function withPageRowOrderLock<T>(parentId: string, work: () => Promise<T>): Promise<T> {
  const previous = locks.get(parentId) ?? Promise.resolve();
  const task = previous.catch(() => undefined).then(work);
  locks.set(parentId, task);
  try { return await task; }
  finally { if (locks.get(parentId) === task) locks.delete(parentId); }
}

export function readOrderRevision(view: unknown): number {
  if (!isJsonRecord(view) || !isJsonRecord(view.rowOrder)) return 0;
  return typeof view.rowOrder.revision === 'number' && Number.isSafeInteger(view.rowOrder.revision)
    ? view.rowOrder.revision : 0;
}

export function rowOrderPath(viewId: string, field?: string): string {
  if (!isUlid(viewId)) throw new Error('View inválida');
  return `$."${viewId}"${field ? `.${field}` : ''}`;
}

/** A failed compare-and-swap aborts the entire SQLite/rqlite transaction. */
export const checkedOrderWrite = (statement: RqliteStatement): RqliteStatement[] => [statement,
  ["INSERT INTO pages (id, owner_id) SELECT '!', NULL WHERE changes() = 0"]];

export function insertRowRankStatement(parentId: string, viewId: string, rowId: string, rank: string): RqliteStatement {
  return [`INSERT INTO page_view_row_order (id, parent_id, view_id, row_id, rank)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(parent_id, view_id, row_id) DO UPDATE SET rank = excluded.rank`,
  ulid(), parentId, viewId, rowId, rank];
}

export function incrementOrderRevisionStatement(parentId: string, viewId: string, expectedRevision: number): RqliteStatement {
  return [`UPDATE pages SET data = json_set(data, ?, ?)
    WHERE id = ? AND deleted_at IS NULL
      AND json_extract(data, ?) = 2 AND COALESCE(json_extract(data, ?), 0) = ?
      AND json_extract(data, ?) IS NULL`,
  rowOrderPath(viewId, 'rowOrder.revision'), expectedRevision + 1, parentId,
  rowOrderPath(viewId, 'rowOrder.version'), rowOrderPath(viewId, 'rowOrder.revision'), expectedRevision,
  rowOrderPath(viewId, 'deletedAt')];
}

async function readView(parentId: string, viewId: string): Promise<Record<string, unknown>> {
  const [records] = await rqlite<{data: string}>([[
    'SELECT data FROM pages WHERE id = ? AND deleted_at IS NULL', parentId,
  ]], 'query');
  const data: unknown = records?.[0]?.data;
  const parsed: unknown = typeof data === 'string' ? JSON.parse(data) : data;
  const view = isJsonRecord(parsed) ? parsed[viewId] : undefined;
  if (!isActivePageView(view)) throw new Error('View não encontrada');
  return view;
}

async function ensureUnlocked(parentId: string, viewId: string, importAttempt=0): Promise<number> {
  let view = await readView(parentId, viewId);
  if (!isJsonRecord(view.rowOrder) || view.rowOrder.version !== PAGE_ROW_ORDER_VERSION) {
    // Import each legacy view in bounded batches. Legacy IDs remain server-side only.
    const oldOrder = Array.isArray(view.orderedRows) ? [...new Set(view.orderedRows.filter(isUlid))] : [];
    const originalOrder = JSON.stringify(view.orderedRows ?? null);
    let lastRank: string | null = null;
    for (let offset = 0;; offset += ROW_ORDER_BACKFILL_BATCH) {
      const [batch] = await rqlite<{row_id: string}>([[
        `SELECT edge.child_id AS row_id FROM page_edges edge
         LEFT JOIN json_each(?) legacy ON legacy.value = edge.child_id
         WHERE edge.parent_id = ? ORDER BY CASE WHEN legacy.key IS NULL THEN 1 ELSE 0 END,
          CAST(legacy.key AS INTEGER), edge.child_id LIMIT ? OFFSET ?`,
        JSON.stringify(oldOrder), parentId, ROW_ORDER_BACKFILL_BATCH, offset,
      ]], 'query');
      if (!batch?.length) break;
      const keys = generateNKeysBetween(lastRank, null, batch.length);
      await rqlite(batch.map((row, offset) => insertRowRankStatement(parentId, viewId, row.row_id, keys[offset]!)),
        'execute', {transaction: true});
      lastRank = keys.at(-1) ?? lastRank;
    }
    const statements = checkedOrderWrite([`UPDATE pages
      SET data = json_set(json_remove(data, ?), ?, json(?))
      WHERE id = ? AND deleted_at IS NULL AND json_extract(data, ?) IS NULL
        AND json_quote(json_extract(data, ?)) = ?
        AND COALESCE(json_extract(data, ?), 0) <> 2`,
    rowOrderPath(viewId, 'orderedRows'), rowOrderPath(viewId, 'rowOrder'), JSON.stringify({version: 2, revision: 0}),
    parentId, rowOrderPath(viewId, 'deletedAt'), rowOrderPath(viewId, 'orderedRows'), originalOrder,
    rowOrderPath(viewId, 'rowOrder.version')]);
    try {
      await rqlite(statements, 'execute', {transaction: true});
    } catch (error) {
      // A legacy tab may have changed its array during import. Never mark the stale import ready.
      if (importAttempt<2) return ensureUnlocked(parentId,viewId,importAttempt+1);
      throw error;
    }
    view = await readView(parentId, viewId);
  }

  // Repairs restored pages and older creation paths without ever loading cells.
  let revision = readOrderRevision(view);
  for (;;) {
    const [missing] = await rqlite<{row_id: string}>([[
      `SELECT edge.child_id AS row_id FROM page_edges edge
       LEFT JOIN page_view_row_order position ON position.parent_id = edge.parent_id
        AND position.view_id = ? AND position.row_id = edge.child_id
       WHERE edge.parent_id = ? AND position.id IS NULL ORDER BY edge.child_id LIMIT ?`,
      viewId, parentId, ROW_ORDER_BACKFILL_BATCH,
    ]], 'query');
    if (!missing?.length) break;
    const [last] = await rqlite<{rank: string}>([[
      `SELECT rank FROM page_view_row_order WHERE parent_id = ? AND view_id = ?
       ORDER BY rank COLLATE BINARY DESC, row_id DESC LIMIT 1`, parentId, viewId,
    ]], 'query');
    const keys = generateNKeysBetween(last?.[0]?.rank ?? null, null, missing.length);
    await rqlite([...checkedOrderWrite(incrementOrderRevisionStatement(parentId, viewId, revision)),
      ...missing.map((row, index) => insertRowRankStatement(parentId, viewId, row.row_id, keys[index]!))],
    'execute', {transaction: true});
    revision++;
  }
  return revision;
}

/** Call with alreadyLocked only from an enclosing withPageRowOrderLock callback. */
export async function ensurePageViewRowOrder(parentId: string, viewId: string, alreadyLocked = false): Promise<number> {
  if (!isUlid(parentId) || !isUlid(viewId)) throw new Error('Página ou view inválida');
  return alreadyLocked ? ensureUnlocked(parentId, viewId)
    : withPageRowOrderLock(parentId, () => ensureUnlocked(parentId, viewId));
}

/** Caller holds the parent lock until these statements have committed with page/edge creation. */
export async function appendCreatedRowOrderStatements(parentId: string, rowId: string): Promise<RqliteStatement[]> {
  const [parents] = await rqlite<{data: string}>([['SELECT data FROM pages WHERE id = ?', parentId]], 'query');
  const raw: unknown = parents?.[0]?.data;
  const data: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const statements: RqliteStatement[] = [];
  if (!isJsonRecord(data)) return statements;
  for (const [viewId, view] of Object.entries(data)) {
    if (!isUlid(viewId) || !isActivePageView(view)) continue;
    const revision = await ensurePageViewRowOrder(parentId, viewId, true);
    const [tail] = await rqlite<{rank: string}>([[
      'SELECT rank FROM page_view_row_order WHERE parent_id = ? AND view_id = ? ORDER BY rank COLLATE BINARY DESC, row_id DESC LIMIT 1',
      parentId, viewId,
    ]], 'query');
    statements.push(incrementOrderRevisionStatement(parentId, viewId, revision),
      insertRowRankStatement(parentId, viewId, rowId, generateKeyBetween(tail?.[0]?.rank ?? null, null)));
  }
  return statements;
}

export async function newViewRowOrderStatements(parentId: string, viewId: string, sourceViewId?: string): Promise<RqliteStatement[]> {
  if (sourceViewId) await ensurePageViewRowOrder(parentId, sourceViewId, true);
  const [rows] = await rqlite<PageViewOrderedRow>([[sourceViewId
    ? 'SELECT row_id, rank FROM page_view_row_order WHERE parent_id = ? AND view_id = ? ORDER BY rank COLLATE BINARY, row_id'
    : 'SELECT child_id AS row_id FROM page_edges WHERE parent_id = ? ORDER BY child_id',
  parentId, ...(sourceViewId ? [sourceViewId] : [])]], 'query');
  const statements: RqliteStatement[] = [];
  let lastRank: string | null = null;
  for (let offset = 0; offset < (rows?.length ?? 0); offset += ROW_ORDER_BACKFILL_BATCH) {
    const batch = rows!.slice(offset, offset + ROW_ORDER_BACKFILL_BATCH);
    const keys: string[] = sourceViewId ? batch.map((row) => row.rank) : generateNKeysBetween(lastRank, null, batch.length);
    batch.forEach((row, index) => statements.push(insertRowRankStatement(parentId, viewId, row.row_id, keys[index]!)));
    lastRank = keys.at(-1) ?? lastRank;
  }
  return statements;
}

export async function compactViewRowRanks(parentId: string, viewId: string, revision: number): Promise<void> {
  const [rows] = await rqlite<PageViewOrderedRow>([[
    'SELECT row_id, rank FROM page_view_row_order WHERE parent_id = ? AND view_id = ? ORDER BY rank COLLATE BINARY, row_id',
    parentId, viewId,
  ]], 'query');
  const keys = generateNKeysBetween(null, null, rows?.length ?? 0);
  await rqlite([...checkedOrderWrite(incrementOrderRevisionStatement(parentId, viewId, revision)),
    ...(rows ?? []).map((row, index) => insertRowRankStatement(parentId, viewId, row.row_id, keys[index]!))],
  'execute', {transaction: true});
}
