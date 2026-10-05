import {DatabaseSync, type SQLInputValue} from 'node:sqlite';
import {performance} from 'node:perf_hooks';
import {generateNKeysBetween} from 'fractional-indexing';
import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
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
import {CELL_PROJECTION_FIELDS,cellProjectionValues,titleValueProjection} from './page-value-projection.js';
import {PageViewQueryStore} from './page-view-query-repository.js';
import {PageViewQueryCursor} from './page-view-query-cursor.js';
import type {QuerySqlFragment} from './page-view-query-filters.js';
import type {PageViewQueryProjection,PageViewQueryRequest} from '@/services/pages/views/page-view-query-contract';

vi.mock('@models/index',()=>({default:{}}));
const id=(value:number)=>`01M${String(value).padStart(23,'0')}`;
const ROOT=id(90000),OWNER=id(90001),VIEW=id(90002),SELECT=id(90003),A=id(90004),B=id(90005),NUMBER=id(90006),TEXT=id(90007),DATE=id(90008),CHECKBOX=id(90009);
interface CapturedRead {sql:string;detail:string[];returned:number;milliseconds:number}
const reads:CapturedRead[]=[];
let sqlite:DatabaseSync,store:PageViewQueryStore;
const setView=(view:string)=>sqlite.prepare('UPDATE pages SET data=? WHERE id=?').run(JSON.stringify({[VIEW]:{
  view,name:view,rowOrder:{version:2,revision:0},board:{selectColumnId:SELECT},dateColumnId:DATE,
  filters:{version:2,clauses:[],groupBy:[],passthrough:[]},
}}),ROOT);

function report(scenario:string,projection:PageViewQueryProjection,milliseconds:number) {
  const details=reads.flatMap(read=>read.detail);
  const indexes=[...new Set(details.flatMap(detail=>[...detail.matchAll(/(?:USING (?:COVERING )?INDEX|USING INDEX) ([A-Za-z0-9_]+)/g)].map(match=>match[1]!)))].sort();
  const hydration=reads.filter(read=>read.sql.includes('GROUP BY selected.window_key'));
  const fixtureCells=(sqlite.prepare('SELECT COUNT(*) AS total FROM page_columns_values').get() as {total:number}).total;
  const result={scenario,fixturePages:10_000,fixtureCells,total:projection.total,
    payloadPages:projection.windows.reduce((total,window)=>total+window.rows.length,0),payloadBytes:Buffer.byteLength(JSON.stringify(projection)),
    maximumHydratedRows:Math.max(0,...hydration.map(read=>read.returned)),queries:reads.length,
    milliseconds:Math.round(milliseconds*100)/100,
    countSqlMilliseconds:Math.round(reads.filter(read=>read.sql.includes('COUNT(')).reduce((sum,read)=>sum+read.milliseconds,0)*100)/100,
    hydrationSqlMilliseconds:Math.round(hydration.reduce((sum,read)=>sum+read.milliseconds,0)*100)/100,
    indexes,temporarySorts:details.filter(detail=>detail.includes('USE TEMP B-TREE')).length};
  console.info(`[query-plan fixture] ${JSON.stringify(result)}`);
  return {details,indexes,hydration,result};
}

beforeAll(()=>{
  sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
  for(const migration of [initial,timestamps,schedule,notifications,flow,recipients,forms,documents,pagination,checkboxIndex]) {
    sqlite.exec('BEGIN');for(const text of migration.up)sqlite.exec(text);sqlite.exec('COMMIT');
  }
  sqlite.prepare('INSERT INTO users(id,email) VALUES (?,?)').run(OWNER,'query-plan@test.local');
  const addPage=sqlite.prepare('INSERT INTO pages(id,title,title_search,projection_version,owner_id,data) VALUES (?,?,?,1,?,?)');
  addPage.run(ROOT,'Base','base',OWNER,'{}');setView('table');
  const addColumn=sqlite.prepare('INSERT INTO page_columns(id,name,type,parent_id,data) VALUES (?,?,?,?,?)');
  addColumn.run(SELECT,'Status','select',ROOT,JSON.stringify({options:[{id:A,value:'A',color:'pink'},{id:B,value:'B',color:'orange'}]}));
  for(const [column,type] of [[NUMBER,'numeric'],[TEXT,'text'],[DATE,'date'],[CHECKBOX,'checkbox']])addColumn.run(column!,type!,type!,ROOT,'{}');
  const addEdge=sqlite.prepare('INSERT INTO page_edges(id,parent_id,child_id) VALUES (?,?,?)');
  const addRank=sqlite.prepare('INSERT INTO page_view_row_order(id,parent_id,view_id,row_id,rank) VALUES (?,?,?,?,?)');
  const addCell=sqlite.prepare(`INSERT INTO page_columns_values(id,page_id,page_column_id,data,${CELL_PROJECTION_FIELDS.join(',')}) VALUES (?,?,?,?,${CELL_PROJECTION_FIELDS.map(()=>'?').join(',')})`);
  const ranks=generateNKeysBetween(null,null,10_000);
  sqlite.exec('BEGIN');
  for(let row=1;row<=10_000;row++) {
    const rowId=id(row),title=`Página ${row}`,date=`2026-10-${String(row%28+1).padStart(2,'0')}T00:00:00.000Z`;
    addPage.run(rowId,title,titleValueProjection(title).title_search!,OWNER,'{}');
    addEdge.run(id(100000+row),ROOT,rowId);addRank.run(id(200000+row),ROOT,VIEW,rowId,ranks[row-1]!);
    for(const [index,column,value] of [[0,SELECT,row%3===0?null:row%3===1?A:B],[1,NUMBER,row],[2,TEXT,`ÁREA ${row%257}`],[3,DATE,date],[4,CHECKBOX,row%1000===0]] as const) {
      const data=JSON.stringify({value});addCell.run(id(300000+row*5+index),rowId,column,data,...cellProjectionValues(data) as SQLInputValue[]);
    }
  }
  sqlite.exec('COMMIT');sqlite.exec('ANALYZE');
  const execute=async<T>(statement:QuerySqlFragment):Promise<T[]>=>{
    const values=statement.values as SQLInputValue[];
    const details=sqlite.prepare(`EXPLAIN QUERY PLAN ${statement.text}`).all(...values) as {detail:string}[];
    const start=performance.now(),rows=sqlite.prepare(statement.text).all(...values) as T[];
    reads.push({sql:statement.text,detail:details.map(row=>row.detail),returned:rows.length,milliseconds:performance.now()-start});return rows;
  };
  store=new PageViewQueryStore(execute,undefined,new PageViewQueryCursor('isolated-query-plan-secret'));
},20_000);
beforeEach(()=>{reads.length=0;setView('table');});
afterAll(()=>sqlite.close());

describe('EXPLAIN actual SQL on an isolated 10,000-page database',()=>{
  it('uses the rank cursor and unique cell lookup while loading at most 50 payload pages',async()=>{
    const start=performance.now(),projection=await store.query(ROOT,VIEW,OWNER,{});
    const evidence=report('table initial',projection,performance.now()-start);
    expect(projection.total).toBe(10_000);expect(evidence.result.payloadPages).toBe(50);expect(evidence.result.maximumHydratedRows).toBe(50);
    expect(reads.some(read=>read.sql.startsWith('SELECT id,rank_key')&&read.returned===51)).toBe(true);
    expect(evidence.indexes).toContain('idx_page_view_row_order_cursor');
    expect(evidence.details.some(detail=>/SEARCH cell USING INDEX .*\(page_id=\?\)/.test(detail))).toBe(true);
    expect(reads.every(read=>read.returned<=51)).toBe(true);
    const token=projection.windows[0]!.nextCursor;expect(token).toBeTruthy();reads.length=0;
    const secondStart=performance.now(),second=await store.query(ROOT,VIEW,OWNER,{cursor:token});
    const secondEvidence=report('table cursor next',second,performance.now()-secondStart);
    expect(second.windows[0]?.rows[0]?.page_id).toBe(id(51));expect(secondEvidence.result.payloadPages).toBe(50);
    expect(secondEvidence.indexes).toContain('idx_page_view_row_order_cursor');
  },20_000);
  it('uses normalized title, numeric and typed cell search indexes for actual filtered projections',async()=>{
    const scenarios:{name:string;columnId:string;condition:'equals'|'greaterThan'|'between';values:string[];index:string|RegExp}[]=[
      {name:'title equality',columnId:'page_title',condition:'equals',values:['PÁGINA 9876'],index:'idx_pages_title_search'},
      {name:'numeric range',columnId:NUMBER,condition:'greaterThan',values:['9870'],index:'idx_page_values_number'},
      {name:'select equality',columnId:SELECT,condition:'equals',values:[A],index:'idx_page_values_select'},
      {name:'text equality',columnId:TEXT,condition:'equals',values:['área 127'],index:'idx_page_values_search'},
      {name:'date overlap',columnId:DATE,condition:'between',values:['2026-10-10','2026-10-12'],index:/idx_page_values_date_(start|end)/},
    ];
    for(const scenario of scenarios) {
      reads.length=0;
      const request:PageViewQueryRequest={filters:{version:2,groupBy:[],clauses:[{columnId:scenario.columnId,condition:scenario.condition,values:scenario.values}]}};
      const start=performance.now(),projection=await store.query(ROOT,VIEW,OWNER,request);
      const evidence=report(scenario.name,projection,performance.now()-start);
      expect(evidence.result.payloadPages).toBeLessThanOrEqual(50);expect(evidence.result.maximumHydratedRows).toBeLessThanOrEqual(50);
      expect(projection.total).toBeGreaterThan(0);
      expect(evidence.indexes.some(index=>typeof scenario.index==='string'?index===scenario.index:scenario.index.test(index))).toBe(true);
    }
  },20_000);
  it('shares the Board preview budget across options without hydrating every card',async()=>{
    setView('board');const start=performance.now(),projection=await store.query(ROOT,VIEW,OWNER,{});
    const evidence=report('board shared initial',projection,performance.now()-start);
    expect(projection.total).toBe(10_000);expect(projection.groups?.map(group=>group.total)).toEqual([3334,3333,3333]);
    expect(evidence.result.payloadPages).toBe(50);expect(evidence.result.maximumHydratedRows).toBeLessThanOrEqual(50);
    expect(projection.windows.every(window=>window.rows.length<=50)).toBe(true);expect(evidence.indexes).toContain('idx_page_view_row_order_cursor');
    expect(reads.every(read=>read.returned<=50)).toBe(true);
  },20_000);
  it('uses the checkbox index for rare true values and keeps the unique-cell left join for false or absence',async()=>{
    for(const value of ['true','false']) {
      reads.length=0;
      // An absent checkbox keeps matching false, so filtering cannot turn this into an inner join.
      if(value==='false')sqlite.prepare('DELETE FROM page_columns_values WHERE page_id=? AND page_column_id=?').run(id(1),CHECKBOX);
      const start=performance.now(),projection=await store.query(ROOT,VIEW,OWNER,{filters:{version:2,groupBy:[],clauses:[{columnId:CHECKBOX,condition:'equals',values:[value]}]}});
      const evidence=report(`checkbox ${value}`,projection,performance.now()-start);
      expect(projection.total).toBe(value==='true'?10:9990);expect(evidence.result.payloadPages).toBe(value==='true'?10:50);
      expect(evidence.indexes).toContain(value==='true'?'idx_page_values_checkbox':'idx_page_columns_values_cell');
      expect(evidence.result.maximumHydratedRows).toBeLessThanOrEqual(50);
    }
  },20_000);
});
