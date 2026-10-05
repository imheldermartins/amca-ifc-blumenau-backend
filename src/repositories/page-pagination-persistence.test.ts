import {DatabaseSync, type SQLInputValue} from 'node:sqlite';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {migration as initial} from '../db/migrations/20260924235507356_619638ca_initial_schema_from_decorators.js';
import {migration as timestamps} from '../db/migrations/20260926211058243_9a36cd7b_repair_literal_updated_at.js';
import {migration as schedule} from '../db/migrations/20260928231611832_eef4196a_add_pinned_schedule_pages.js';
import {migration as notifications} from '../db/migrations/20260930002722501_55bb4d04_add_schedule_notifications.js';
import {migration as flow} from '../db/migrations/20260930031603388_4569bf7a_add_flow_columns_and_single_page_parent.js';
import {migration as recipients} from '../db/migrations/20261001052915696_6534e769_allow_external_notification_recipients.js';
import {migration as forms} from '../db/migrations/20261002205813488_79c27e84_add_form_publications_and_submissions.js';
import {migration as documents} from '../db/migrations/20261002211726828_d11f844f_add_page_documents.js';
import {migration as pagination} from '../db/migrations/20261004220750243_5ed96b46_add_paginated_database_projections_and_row_order.js';
import {migration as checkboxIndex} from '../db/migrations/20261005042200087_ab97d31a_index_paginated_checkbox_predicates.js';
import {deriveCellProjection, dateValueInterval, normalizeSearchText, titleValueProjection} from './page-value-projection.js';
import {sanitizeViewSnapshot, stripPageQueryInternals} from '@/services/pages/views/page-query-serialization';

const {execute} = vi.hoisted(() => ({execute: vi.fn()}));
vi.mock('@/db/client-db', () => ({rqlite: execute}));
vi.mock('@models/index', () => ({default:{}}));
import {appendCreatedRowOrderStatements, checkedOrderWrite, ensurePageViewRowOrder, withPageRowOrderLock} from './page-view-row-order.js';
import {backfillDatabaseValueProjections, backfillDatabaseViewOrders, pendingDatabaseProjectionCounts} from './page-projection-backfill.js';
import {PageViewRowMoveStore} from './page-view-row-move-repository.js';
import {insertPageViewJson, updatePageJsonPaths} from './page-json.js';
import {pageCellUpsertStatement} from './page-cell-statements.js';
import {initializePageViewSnapshot, prepareInitialPageViewSnapshot} from './page-view-initial-snapshot.js';

const id = (value: number) => `01M${String(value).padStart(23, '0')}`;
const PARENT = id(90000), OWNER = id(90001), VIEW = id(90002), SELECT = id(90003), A = id(90004), B = id(90005), VIEWER = id(90006);
let sqlite: DatabaseSync;
let beforeCommit: (() => void) | undefined;

const rowOrder = () => (sqlite.prepare('SELECT row_id FROM page_view_row_order WHERE parent_id=? AND view_id=? ORDER BY rank COLLATE BINARY,row_id').all(PARENT, VIEW) as {row_id:string}[]).map((row) => row.row_id);
const parentData = () => JSON.parse((sqlite.prepare('SELECT data FROM pages WHERE id=?').get(PARENT) as {data:string}).data) as Record<string, any>;
const setParent = (data: Record<string, unknown>) => sqlite.prepare('UPDATE pages SET data=? WHERE id=?').run(JSON.stringify(data), PARENT);
const rowCell = (row: number) => sqlite.prepare('SELECT * FROM page_columns_values WHERE page_id=? AND page_column_id=?').get(id(row), SELECT) as Record<string, unknown> | undefined;

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:'); sqlite.exec('PRAGMA foreign_keys=ON');
  for (const migration of [initial,timestamps,schedule,notifications,flow,recipients,forms,documents,pagination,checkboxIndex]) {
    sqlite.exec('BEGIN'); for (const text of migration.up) sqlite.exec(text); sqlite.exec('COMMIT');
  }
  sqlite.prepare('INSERT INTO users(id,email) VALUES (?,?),(?,?)').run(OWNER,'owner@test.local',VIEWER,'viewer@test.local');
  sqlite.prepare('INSERT INTO pages(id,title,owner_id,data,updated_at) VALUES (?,?,?,?,?)').run(PARENT,'ÁREA',OWNER,JSON.stringify({metadata:'plain string',[VIEW]:{view:'board',name:'Quadros',orderedRows:[id(3),id(1),id(99999)],board:{selectColumnId:SELECT}}}),'2026-09-01T00:00:00.000Z');
  sqlite.prepare('INSERT INTO page_columns(id,name,type,parent_id,data) VALUES (?,?,?,?,?)').run(SELECT,'Status','select',PARENT,JSON.stringify({options:[{id:A,value:'A',color:'pink'},{id:B,value:'B',color:'orange'}]}));
  for (let row=1;row<=4;row++) {
    sqlite.prepare('INSERT INTO pages(id,title,owner_id) VALUES (?,?,?)').run(id(row),`Página ${row}`,OWNER);
    sqlite.prepare('INSERT INTO page_edges(id,parent_id,child_id) VALUES (?,?,?)').run(id(100+row),PARENT,id(row));
  }
  execute.mockImplementation(async (statements: RqliteStatement[], endpoint: string, options?:{transaction?:boolean}) => {
    if (options?.transaction && beforeCommit) { const callback=beforeCommit; beforeCommit=undefined; callback(); }
    if (options?.transaction) sqlite.exec('BEGIN');
    try {
      const result = statements.map(([text,...values]) => {
        const statement=sqlite.prepare(String(text));
        return endpoint==='query' ? statement.all(...values as SQLInputValue[]) : Number(statement.run(...values as SQLInputValue[]).changes)>0;
      });
      if (options?.transaction) sqlite.exec('COMMIT'); return result;
    } catch (error) { if (options?.transaction) sqlite.exec('ROLLBACK'); throw error; }
  });
  beforeCommit=undefined;
});
afterEach(() => sqlite.close());

describe('persisted pagination projection', () => {
  it('folds Unicode without coercing invalid numeric/checkbox cells', () => {
    expect(normalizeSearchText('AÇÃO É Ç')).toBe('acao e c');
    expect(titleValueProjection(null).title_search).toBeNull();
    expect(deriveCellProjection('{"value":false}')).toMatchObject({checkbox_value:0,value_kind:'boolean'});
    expect(deriveCellProjection('{"value":"12"}')).toMatchObject({number_value:null,value_kind:'string'});
    expect(deriveCellProjection('{"value":12}')).toMatchObject({number_value:12,value_kind:'number'});
    expect(deriveCellProjection('invalid')).toMatchObject({value_kind:'missing',projection_version:1});
    expect(deriveCellProjection(JSON.stringify({value:A})).select_option_id).toBe(A);
    expect(deriveCellProjection('{"value":"opção"}').select_option_id).toBeNull();
    expect(dateValueInterval('2026-10-03@2026-10-01')).toEqual([Date.parse('2026-10-01'),Date.parse('2026-10-04')-1]);
  });
  it('imports hidden/unordered rows in legacy order, preserving timestamps and revision, then is idempotent', async () => {
    sqlite.prepare('UPDATE pages SET deleted_at=? WHERE id=?').run('2026-10-01',id(3));
    expect(await pendingDatabaseProjectionCounts()).toMatchObject({pages:5,views:1});
    await backfillDatabaseValueProjections(); expect(await backfillDatabaseViewOrders()).toBe(1);
    expect(rowOrder()).toEqual([id(3),id(1),id(2),id(4)]);
    expect(parentData()[VIEW]).toMatchObject({rowOrder:{version:2,revision:0}});
    expect(parentData()[VIEW]).not.toHaveProperty('orderedRows');
    expect(sqlite.prepare('SELECT updated_at,dataset_revision,title_search FROM pages WHERE id=?').get(PARENT)).toMatchObject({updated_at:'2026-09-01T00:00:00.000Z',dataset_revision:0,title_search:'area'});
    expect(await backfillDatabaseValueProjections()).toEqual({pages:0,cells:0});
    expect(await backfillDatabaseViewOrders()).toBe(0);
    expect(await pendingDatabaseProjectionCounts()).toEqual({pages:0,cells:0,views:0});
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
  it('backfills over 500 pages and cells in bounded batches with malformed metadata', async () => {
    for(let row=5;row<=510;row++) {
      sqlite.prepare('INSERT INTO pages(id,title,owner_id) VALUES (?,?,?)').run(id(row),'ÉXTRA',OWNER);
      sqlite.prepare('INSERT INTO page_edges(id,parent_id,child_id) VALUES (?,?,?)').run(id(2000+row),PARENT,id(row));
      sqlite.prepare('INSERT INTO page_columns_values(id,page_id,page_column_id,data) VALUES (?,?,?,?)').run(id(3000+row),id(row),SELECT,row%2?'invalid':JSON.stringify({value:A}));
    }
    await backfillDatabaseValueProjections(); await backfillDatabaseViewOrders();
    expect(rowOrder()).toHaveLength(510); expect(await pendingDatabaseProjectionCounts()).toEqual({pages:0,cells:0,views:0});
    expect(execute.mock.calls.some(([statements,endpoint])=>endpoint==='query' && statements.some((statement:RqliteStatement)=>String(statement[0]).includes('LIMIT ?') && (statement as unknown[]).includes(500)))).toBe(true);
  });
  it('writes cell projections and canonical envelope in one statement', async () => {
    await execute([pageCellUpsertStatement(id(1),SELECT,JSON.stringify({value:A}))],'execute');
    expect(rowCell(1)).toMatchObject({select_option_id:A,value_kind:'string',projection_version:1});
    await execute([pageCellUpsertStatement(id(1),SELECT,JSON.stringify({value:false}))],'execute');
    expect(rowCell(1)).toMatchObject({select_option_id:null,checkbox_value:0,value_kind:'boolean'});
  });
  it('clones ranks, seeds new views and atomically rejects stale orderedRows patches', async () => {
    await ensurePageViewRowOrder(PARENT,VIEW);
    const CLONE=id(91000); await insertPageViewJson(PARENT,CLONE,{view:'table',name:'Clone',orderedRows:[id(2)]},VIEW);
    expect(parentData()[CLONE]).not.toHaveProperty('orderedRows');
    expect((sqlite.prepare('SELECT row_id FROM page_view_row_order WHERE view_id=? ORDER BY rank').all(CLONE) as {row_id:string}[]).map(row=>row.row_id)).toEqual(rowOrder());
    expect(await updatePageJsonPaths(PARENT,[{path:[VIEW,'orderedRows'],value:[id(2)]}],VIEW)).toBe(false);
    expect(await updatePageJsonPaths(PARENT,[{path:[VIEW,'name'],value:'Novo nome'}],VIEW)).toBe(true);
    const NEXT=id(5); await withPageRowOrderLock(PARENT, async()=>{
      const append=await appendCreatedRowOrderStatements(PARENT,NEXT);
      await execute([['INSERT INTO pages(id,title,owner_id) VALUES (?,?,?)',NEXT,'Nova',OWNER],['INSERT INTO page_edges(id,parent_id,child_id) VALUES (?,?,?)',id(1005),PARENT,NEXT],...append].flatMap(checkedOrderWrite),'execute',{transaction:true});
    });
    expect(rowOrder().at(-1)).toBe(NEXT); expect(parentData()[VIEW].rowOrder.revision).toBe(1);
    expect(parentData()[CLONE].rowOrder.revision).toBe(1);
  });
  it('strips internals and migrated arrays without touching legacy snapshots',()=>{
    const data={[VIEW]:{view:'table',orderedRows:[id(1)]},[id(91000)]:{view:'board',rowOrder:{version:2},orderedRows:[id(2)]}};
    const sanitized=sanitizeViewSnapshot(data) as Record<string, unknown>;
    expect(sanitized[VIEW]).toHaveProperty('orderedRows');
    expect(sanitized[id(91000)]).not.toHaveProperty('orderedRows');
    const page=stripPageQueryInternals({id:PARENT,title_search:'area',projection_version:1,dataset_revision:10,data});
    expect(page).not.toHaveProperty('title_search'); expect(page).not.toHaveProperty('dataset_revision');
  });
  it('materializes the fallback snapshot and ranks atomically, then prevents full snapshot overwrites',async()=>{
    setParent({metadata:'retained'});
    const initial=await prepareInitialPageViewSnapshot(PARENT,{metadata:'retained',[VIEW]:{view:'table',name:'Tabela',orderedRows:[id(1)]}});
    await execute([...initial.before.map(statement=>[statement.text,...statement.values]),
      ['UPDATE pages SET data=? WHERE id=?',JSON.stringify(initial.data),PARENT],...initial.after].flatMap(checkedOrderWrite),'execute',{transaction:true});
    expect(parentData()[VIEW]).toMatchObject({rowOrder:{version:2,revision:0}});
    expect(parentData().metadata).toBe('retained');expect(rowOrder()).toEqual([1,2,3,4].map(id));
    await expect(prepareInitialPageViewSnapshot(PARENT,{[VIEW]:{view:'table',name:'Sobrescrito',orderedRows:[]}})).rejects.toThrow(/materializado/);
    expect(()=>initializePageViewSnapshot({[VIEW]:{view:'table',rowOrder:{version:2,revision:999}}})).toThrow(/gerenciada/);
  });
  it('does not overwrite a concurrently changed snapshot during initial materialization',async()=>{
    setParent({metadata:'first'});
    const initial=await prepareInitialPageViewSnapshot(PARENT,{[VIEW]:{view:'table',name:'Tabela'}});
    setParent({metadata:'concurrent'});
    await expect(execute([...initial.before.map(statement=>[statement.text,...statement.values]),
      ['UPDATE pages SET data=? WHERE id=?',JSON.stringify(initial.data),PARENT],...initial.after].flatMap(checkedOrderWrite),'execute',{transaction:true})).rejects.toThrow();
    expect(parentData()).toEqual({metadata:'concurrent'});expect(rowOrder()).toEqual([]);
  });
});

describe('atomic moves by anchor',()=>{
  const store=new PageViewRowMoveStore();
  async function prepare() {
    await ensurePageViewRowOrder(PARENT,VIEW);
    for(const row of [1,2,3]) await execute([pageCellUpsertStatement(id(row),SELECT,JSON.stringify({value:A}))],'execute');
  }
  it('moves before a loaded anchor without losing unloaded rows and commits select plus order together',async()=>{
    await prepare();
    expect(await store.move(PARENT,VIEW,OWNER,{rowId:id(2),beforeId:id(3),expectedOrderRevision:0})).toMatchObject({orderRevision:1,optionId:A});
    expect(rowOrder()).toEqual([id(2),id(3),id(1),id(4)]);
    await store.move(PARENT,VIEW,OWNER,{rowId:id(2),boundary:'end',expectedOrderRevision:1,targetOptionId:B,previousOptionId:A});
    expect(rowCell(2)).toMatchObject({select_option_id:B});
    await store.move(PARENT,VIEW,OWNER,{rowId:id(2),boundary:'start',expectedOrderRevision:2,targetOptionId:null,previousOptionId:B});
    expect(rowCell(2)).toBeUndefined(); expect(parentData()[VIEW].rowOrder.revision).toBe(3);
  });
  it('honors select locks while allowing same-Board reorder and preserves removed options',async()=>{
    await prepare(); const data=parentData(); data.columnLocks={[SELECT]:{userIds:[]}}; setParent(data);
    await store.move(PARENT,VIEW,OWNER,{rowId:id(2),beforeId:id(1),expectedOrderRevision:0});
    await expect(store.move(PARENT,VIEW,OWNER,{rowId:id(2),boundary:'end',expectedOrderRevision:1,targetOptionId:B,previousOptionId:A})).rejects.toMatchObject({reason:'forbidden'});
    await execute([pageCellUpsertStatement(id(4),SELECT,JSON.stringify({value:id(99999)}))],'execute');
    await store.move(PARENT,VIEW,OWNER,{rowId:id(4),boundary:'end',expectedOrderRevision:1});
    expect(rowCell(4)?.select_option_id).toBe(id(99999));
  });
  it('rejects stale revision and rolls back an assignment when a commit permission/lock guard changes',async()=>{
    await prepare();
    await expect(store.move(PARENT,VIEW,OWNER,{rowId:id(1),boundary:'end',expectedOrderRevision:8})).rejects.toMatchObject({reason:'conflict',confirmed:{orderRevision:0}});
    const order=rowOrder(); beforeCommit=()=>{const data=parentData();data.columnLocks={[SELECT]:{userIds:[]}};setParent(data);};
    await expect(store.move(PARENT,VIEW,OWNER,{rowId:id(1),boundary:'end',expectedOrderRevision:0,targetOptionId:B,previousOptionId:A})).rejects.toMatchObject({reason:'conflict'});
    expect(rowCell(1)?.select_option_id).toBe(A);expect(rowOrder()).toEqual(order);expect(parentData()[VIEW].rowOrder.revision).toBe(0);
  });
  it('blocks unreadable anchors and users without update permission before exposing current state',async()=>{
    await prepare();
    await expect(store.move(PARENT,VIEW,VIEWER,{rowId:id(1),beforeId:id(2),expectedOrderRevision:0})).rejects.toMatchObject({reason:'forbidden',confirmed:undefined});
    await expect(store.move(PARENT,VIEW,OWNER,{rowId:id(1),beforeId:id(99999),expectedOrderRevision:0})).rejects.toMatchObject({reason:'conflict'});
  });
  it('handles malformed legacy select envelopes as the neutral Board',async()=>{
    await prepare();
    sqlite.prepare('INSERT INTO page_columns_values(id,page_id,page_column_id,data) VALUES (?,?,?,?)').run(id(500),id(4),SELECT,'malformed');
    await store.move(PARENT,VIEW,OWNER,{rowId:id(4),boundary:'start',expectedOrderRevision:0});
    expect(rowCell(4)?.data).toBe('malformed');
  });
  it('allocates globally unique ranks when moving across interleaved Boards',async()=>{
    await prepare();
    await execute([pageCellUpsertStatement(id(1),SELECT,JSON.stringify({value:B})),pageCellUpsertStatement(id(4),SELECT,JSON.stringify({value:B}))],'execute');
    // Legacy order is 3(A),1(B),2(A),4(B): the gap between A cards already contains B's rank.
    await store.move(PARENT,VIEW,OWNER,{rowId:id(4),beforeId:id(2),expectedOrderRevision:0,targetOptionId:A,previousOptionId:B});
    const ranks=sqlite.prepare('SELECT rank FROM page_view_row_order WHERE view_id=?').all(VIEW) as {rank:string}[];
    expect(new Set(ranks.map(row=>row.rank)).size).toBe(ranks.length);
    await execute([pageCellUpsertStatement(id(1),SELECT,JSON.stringify({value:A}))],'execute');
    await expect(store.move(PARENT,VIEW,OWNER,{rowId:id(2),beforeId:id(4),expectedOrderRevision:1})).resolves.toMatchObject({orderRevision:2});
  });
  it('rebalances preexisting equal ranks without assigning a select value',async()=>{
    await prepare();
    const first=sqlite.prepare('SELECT rank FROM page_view_row_order WHERE row_id=? AND view_id=?').get(id(1),VIEW) as {rank:string};
    sqlite.prepare('UPDATE page_view_row_order SET rank=? WHERE row_id=? AND view_id=?').run(first.rank,id(3),VIEW);
    await expect(store.move(PARENT,VIEW,OWNER,{rowId:id(2),beforeId:id(3),expectedOrderRevision:0,targetOptionId:A,previousOptionId:A})).rejects.toMatchObject({reason:'conflict',confirmed:{orderRevision:1}});
    const ranks=sqlite.prepare('SELECT rank FROM page_view_row_order WHERE view_id=?').all(VIEW) as {rank:string}[];
    expect(new Set(ranks.map(row=>row.rank)).size).toBe(ranks.length);expect(rowCell(2)?.select_option_id).toBe(A);
  });
  it('uses the same default select as SQL metadata when visual property order differs',async()=>{
    await prepare();
    const secondSelect=id(90050);
    sqlite.prepare('INSERT INTO page_columns(id,name,type,parent_id,data,created_at) VALUES (?,?,?,?,?,?)').run(secondSelect,'Other status','select',PARENT,JSON.stringify({options:[{id:A,value:'A'},{id:B,value:'B'}]}),'2000-01-01');
    const data=parentData();delete data[VIEW].board.selectColumnId;data[VIEW].orderedHeaderCols=[secondSelect,SELECT];setParent(data);
    const result=await store.move(PARENT,VIEW,OWNER,{rowId:id(2),boundary:'end',expectedOrderRevision:0,targetOptionId:B,previousOptionId:A});
    expect(result.selectColumnId).toBe(SELECT);expect(rowCell(2)?.select_option_id).toBe(B);
    expect(sqlite.prepare('SELECT 1 FROM page_columns_values WHERE page_id=? AND page_column_id=?').get(id(2),secondSelect)).toBeUndefined();
  });
});
