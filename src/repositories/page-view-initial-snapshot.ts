import {rqlite} from '@/db/client-db';
import {isActivePageView, isJsonRecord, isUlid} from '@/services/pages/views/page-view-parsers';
import {newViewRowOrderStatements} from '@/repositories/page-view-row-order';

/** New pages have no children yet; view order metadata is managed by the server. */
export function initializePageViewSnapshot(input: unknown): unknown {
  if (!isJsonRecord(input)) return input;
  const data = {...input};
  for (const [viewId, view] of Object.entries(data)) {
    if (!isUlid(viewId) || !isActivePageView(view)) continue;
    if (view.rowOrder !== undefined) throw new Error('A ordem da view é gerenciada pelo servidor');
    const {orderedRows: _legacy, ...preferences} = view;
    data[viewId] = {...preferences, rowOrder:{version:2,revision:0}};
  }
  return data;
}

/** Full snapshot writes are limited to initial materialization, with a transactional CAS. */
export async function prepareInitialPageViewSnapshot(pageId: string, input: unknown): Promise<{
  data: unknown; before: SqlStatement[]; after: RqliteStatement[];
}> {
  const [rows] = await rqlite<{data:string|null}>([['SELECT data FROM pages WHERE id=? AND deleted_at IS NULL',pageId]],'query');
  if (!rows?.[0]) throw new Error('Página não encontrada');
  const stored=rows[0].data;
  let current: unknown = stored;
  try { if (typeof stored==='string') current=JSON.parse(stored); } catch { current=null; }
  if (isJsonRecord(current) && Object.entries(current).some(([key,value])=>isUlid(key)&&isActivePageView(value))) {
    throw new Error('O snapshot já foi materializado; altere as preferências pelo endpoint da view');
  }
  const data=initializePageViewSnapshot(input);
  const after: RqliteStatement[]=[];
  if (isJsonRecord(data)) {
    for (const [viewId,view] of Object.entries(data)) {
      if (isUlid(viewId)&&isActivePageView(view)) after.push(...await newViewRowOrderStatements(pageId,viewId));
    }
  }
  return {data, before:[{text:'UPDATE pages SET data=data WHERE id=? AND deleted_at IS NULL AND data IS ?',values:[pageId,stored]}],after};
}
