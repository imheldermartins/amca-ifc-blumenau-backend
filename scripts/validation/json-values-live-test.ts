import assert from 'node:assert/strict';
import { ulid } from 'ulid';
import db from '../../src/models/index.js';
import { db as client, rqlite } from '../../src/db/client-db.js';
import hierarchy from '../../src/repositories/page-hierarchy-repository.js';
import values from '../../src/controllers/page-column-value-controller.js';
import relations from '../../src/repositories/page-relation-repository.js';
import blocks from '../../src/repositories/page-document-repository.js';
import { PageViewQueryStore } from '../../src/repositories/page-view-query-repository.js';
import type { Schema } from '../../src/db/schemas/index.js';

assert.equal(process.env.DATABASE_URL, 'http://127.0.0.1:8000', 'Only the local development database is allowed');
await client.waitForDatabase();
await client.assertReady();
const owner = ulid(), root = ulid(), view = ulid();
const numeric = ulid(), date = ulid(), relation = ulid(), rollup = ulid();
const pages = [root], columns = [numeric,date,relation,rollup];
let checks = 0;
function check(label: string, actual: unknown, expected: unknown) {
  assert.deepEqual(actual,expected,label); checks++; console.log(`PASS ${label}`);
}

try {
  await db.users.createWithId(owner,{name:'Temporary JSON contract fixture',email:`json-contract-${owner}@test.local`} as CreateValues<Schema.User>);
  await db.pages.createWithId(root,{title:'Temporary JSON validation',owner_id:owner,data:{[view]:{
    view:'table',name:'Tabela',rowOrder:{version:2,revision:0},filters:{version:2,updatedAt:null,clauses:[],groupBy:[],passthrough:[]},
  }}} as CreateValues<Schema.Page>);
  await db.workspaces.createWithId(root,{name:'Temporary validation',created_by_user_id:owner,data:{},icon:'lucide:test-tube'} as CreateValues<Schema.Workspace>);
  await db.workspaceMembers.create({workspace_id:root,user_id:owner,page_root_id:root} as CreateValues<Schema.WorkspaceMember>);
  const source = await hierarchy.createChild(root,owner,{title:'Ação local'});
  assert.ok(source); pages.push(source.id);
  const target = await hierarchy.createChild(root,owner,{title:'Alvo'});
  assert.ok(target); pages.push(target.id);
  for (const [id,name,type,data] of [
    [numeric,'Número','numeric',{}], [date,'Data','date',{}],
    [relation,'Relação','relation',{relation:{version:1,targetDatabaseId:root}}],
    [rollup,'Resumo','extract_as',{rollup:{version:1,relationColumnId:relation,targetColumnId:numeric,operation:'sum'}}],
  ] as const) await db.pageColumns.createWithId(id,{name,type,parent_id:root,data} as CreateValues<Schema.PageColumn>);

  for (const [page,column,value] of [[source.id,numeric,4],[target.id,numeric,9],[source.id,date,'2026-10-12T09:05:00.123Z'],[source.id,relation,[target.id]]] as const) {
    const result = await values.createValue({page_id:page,page_column_id:column,value},owner);
    assert.ok(result.ok, result.ok ? '' : result.message);
  }
  const [fields] = await rqlite<{name:string}>([['PRAGMA table_info(page_columns_values)']],'query');
  check('cell schema contains only standard fields and data',fields?.map(field=>field.name),['id','created_at','updated_at','data','page_column_id','page_id']);
  const [stored] = await rqlite<{data:string}>([['SELECT data FROM page_columns_values WHERE page_id=? AND page_column_id=?',source.id,relation]],'query');
  check('relation is stored only as the canonical ULID array',JSON.parse(stored![0]!.data),{value:[target.id]});
  check('rollup joins JSON targets to indexed pages',await relations.resolveRollupValues({data:{rollup:{version:1,relationColumnId:relation,targetColumnId:numeric,operation:'sum'}}},[source.id],owner),{[source.id]:9});
  const store = new PageViewQueryStore();
  const result = await store.query(root,view,owner,{filters:{version:2,groupBy:[],clauses:[{columnId:'page_title',condition:'equals',values:['acao local']}]}});
  check('title simplification reads pages.title',result.windows[0]?.rows.map(row=>row.page_id),[source.id]);
  const dates = await store.query(root,view,owner,{filters:{version:2,groupBy:[],clauses:[{columnId:date,condition:'equals',values:['2026-10-12']}]}});
  check('millisecond ISO date is read from JSON',dates.windows[0]?.rows.map(row=>row.page_id),[source.id]);
  const [orders] = await rqlite<{total:number}>([['SELECT COUNT(*) AS total FROM page_view_row_order position JOIN page_edges edge ON edge.id=position.edge_id WHERE edge.parent_id=? AND position.view_id=?',root,view]],'query');
  check('child creation commits positions through the edge',orders?.[0]?.total,2);
  const content = {type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Editor JSON local'}]}]};
  const saved = await blocks.save(source.id,content);
  assert.ok(saved,'Block save must return the persisted document');
  check('block editor saves and reads the renamed page_blocks table',(await blocks.find(source.id))?.content,content);
  check('block editor increments its save revision',(await blocks.save(source.id,content))?.revision,(saved?.revision ?? 0)+1);
  const [foreignKeys] = await rqlite<unknown>([['PRAGMA foreign_key_check']],'query');
  check('no foreign-key violations',foreignKeys,[]);
  console.log(JSON.stringify({target:'http://127.0.0.1:8000',checks,temporaryFixtures:true}));
} finally {
  const placeholders = pages.map(()=>'?').join(',');
  await rqlite([
    ['DELETE FROM page_columns_values WHERE page_id IN ('+placeholders+')',...pages],
    ['DELETE FROM page_blocks WHERE page_id IN ('+placeholders+')',...pages],
    ['DELETE FROM page_view_row_order WHERE edge_id IN (SELECT id FROM page_edges WHERE parent_id=?)',root],
    ['DELETE FROM page_columns WHERE id IN ('+columns.map(()=>'?').join(',')+')',...columns],
    ['DELETE FROM page_roles WHERE page_id IN ('+placeholders+')',...pages],
    ['DELETE FROM page_edges WHERE parent_id=?',root],
    ['DELETE FROM workspace_members WHERE workspace_id=?',root],
    ['DELETE FROM workspaces WHERE id=?',root],
    ['DELETE FROM pages WHERE id IN ('+placeholders+')',...pages],
    ['DELETE FROM users WHERE id=?',owner],
  ],'execute',{transaction:true});
  console.log('Temporary fixtures removed; no test user or password retained.');
}
