import {DatabaseSync,type SQLInputValue} from 'node:sqlite';
import {readdir} from 'node:fs/promises';
import {describe,it,expect} from 'vitest';
import {PageFormulaRepository, type FormulaCommit} from './page-formula-repository.js';
import type {Schema} from '@/db/schemas/index';
const id=(n:number)=>`01M${String(n).padStart(23,'0')}`;
const owner=id(1),other=id(2),root=id(3),target=id(4),row=id(5),order=id(6),number=id(7),relation=id(8),amount=id(9),formula=id(10),extract=id(11);
async function fixture(){
  const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
  const migrations=await readdir(new URL('../db/migrations/',import.meta.url));
  const ordered=migrations.filter(f=>f.endsWith('.ts')).sort();
  const renameIndex=ordered.findIndex(name=>name.includes('formula_and_extract_as_columns'));
  for(const name of ordered.slice(0,renameIndex)){const {migration}=await import(new URL('../db/migrations/'+name,import.meta.url).href);db.exec('BEGIN;'+migration.up.join(';')+';COMMIT;')}
  db.prepare('INSERT INTO users(id,email,name,password_hash) VALUES(?,?,?,?)').run(owner,'owner@test.local','Owner','hash');
  db.prepare('INSERT INTO users(id,email,name,password_hash) VALUES(?,?,?,?)').run(other,'other@test.local','Other','hash');
  for(const page of [root,target,row,order])db.prepare('INSERT INTO pages(id,title,owner_id,data) VALUES(?,?,?,?)').run(page,'Título',owner,'{}');
  for(const [parent,child] of [[root,row],[target,order]])db.prepare('INSERT INTO page_edges(id,parent_id,child_id) VALUES(?,?,?)').run(child!,parent!,child!);
  for(const [column,name,type,parent,data] of [[number,'Total','numeric',root,{}],[relation,'Pedidos','relation',root,{relation:{version:1,targetDatabaseId:target}}],[amount,'Valor','numeric',target,{}],[extract,'Resumo','rollup',root,{rollup:{version:1,relationColumnId:relation,operation:'count'}}]] as const)db.prepare('INSERT INTO page_columns(id,name,type,parent_id,data) VALUES(?,?,?,?,?)').run(column,name,type,parent,JSON.stringify(data));
  for(const [page,column,value] of [[row,number,10],[row,relation,[order]],[order,amount,7]] as const)db.prepare('INSERT INTO page_columns_values(id,page_id,page_column_id,data) VALUES(?,?,?,?)').run(column,page,column,JSON.stringify({value}));
  db.prepare('INSERT INTO workspaces(id,name,created_by_user_id) VALUES(?,?,?)').run(root,'Test',owner);
  db.prepare('INSERT INTO pinned_schedule_pages(id,workspace_id,page_id,pinned_by_user_id,date_column_id) VALUES(?,?,?,?,?)').run(id(12),root,row,owner,number);
  for(const name of ordered.slice(renameIndex)){const {migration}=await import(new URL('../db/migrations/'+name,import.meta.url).href);db.exec('BEGIN;'+migration.up.join(';')+';COMMIT;')}
  const execute=async<T>(query:string|SqlStatement)=>{const statement=typeof query==='string'?{text:query,values:[]}:query;return db.prepare(statement.text).all(...statement.values as SQLInputValue[]) as T[]};
  const commit: FormulaCommit = async(statements) => {
    db.exec('BEGIN');
    try {
      const result = statements.map(statement => {
        const [text, ...values] = typeof statement === 'string' ? [statement] : statement;
        return Number(db.prepare(String(text)).run(...values as SQLInputValue[]).changes) > 0;
      });
      db.exec('COMMIT');return result;
    } catch(error) {db.exec('ROLLBACK');throw error;}
  };
  const repo=new PageFormulaRepository(execute,commit);
  return {db,repo};
}
describe('Formula repository and migration',()=>{
  it('renames rollup without losing values, configuration or foreign keys',async()=>{const {db}=await fixture();try{
    expect(db.prepare('SELECT type,data FROM page_columns WHERE id=?').get(extract)).toMatchObject({type:'extract_as',data:JSON.stringify({rollup:{version:1,relationColumnId:relation,operation:'count'}})});
    expect(db.prepare('SELECT COUNT(*) AS n FROM page_columns_values').get()).toMatchObject({n:3});expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]); expect(db.prepare('SELECT date_column_id FROM pinned_schedule_pages').get()).toMatchObject({date_column_id:number});
    expect(db.prepare('SELECT source_cell_id,target_page_id,position FROM page_relation_links').all()).toEqual([{source_cell_id:relation,target_page_id:order,position:0}]);
    expect(()=>db.prepare('UPDATE page_columns SET type=? WHERE id=?').run('rollup',extract)).toThrow();
  }finally{db.close()}});
  it('binds canonical IDs and computes authorized relation values',async()=>{const {db,repo}=await fixture();try{
    const definition=await repo.definition(root,owner,{version:1,source:'map(@Pedidos,@Valor).sum()+@Total'});
    expect(definition.source).toContain('@columns.');expect(definition.revision).toBe(1);
    expect(await repo.evaluate(root,definition.source,formula,[row],owner)).toMatchObject({[row]:{ok:true,value:17}});
    expect(await repo.catalog(root,other)).toEqual([]);
    const hidden=await repo.evaluate(root,definition.source,formula,[row],other);expect(hidden[row]?.ok).toBe(false);
  }finally{db.close()}});
  it('rejects invalid saves and mismatched revisions',async()=>{const {db,repo}=await fixture();try{
    await expect(repo.definition(root,owner,{version:1,source:'@Total + 1/0'})).rejects.toThrow('zero');
    const previous=await repo.definition(root,owner,{version:1,source:'1'});
    await expect(repo.definition(root,owner,{version:1,source:'2',expectedRevision:0},formula,previous)).rejects.toThrow('alterada');
  }finally{db.close()}});
  it('allows only one concurrent definition replacement',async()=>{const {db,repo}=await fixture();try{
    const data={formula:await repo.definition(root,owner,{version:1,source:'1'})};
    db.prepare('INSERT INTO page_columns(id,name,type,parent_id,data) VALUES(?,?,?,?,?)').run(formula,'Fórmula','formula',root,JSON.stringify(data));
    const existing={id:formula,name:'Fórmula',type:'formula',parent_id:root,data} as Schema.PageColumn;
    const next={data:{formula:{...data.formula,source:'2',revision:2}}};
    expect(await Promise.all([repo.compareAndUpdate(existing,next),repo.compareAndUpdate(existing,next)])).toEqual([true,false]);
  }finally{db.close()}});
  it('invalidates only dependent databases containing formulas',async()=>{const {db,repo}=await fixture();try{
    expect(await repo.affectedDatabases(target)).toEqual([]);
    db.prepare('INSERT INTO page_columns(id,name,type,parent_id,data) VALUES(?,?,?,?,?)').run(formula,'Fórmula','formula',root,JSON.stringify({formula:{version:1,source:'1',revision:1}}));
    expect(await repo.affectedDatabases(target)).toEqual([root]);
  }finally{db.close()}});
  it('rolls back the definition if the page activity write fails',async()=>{const {db,repo}=await fixture();try{
    const data={formula:await repo.definition(root,owner,{version:1,source:'1'})};
    db.prepare('INSERT INTO page_columns(id,name,type,parent_id,data) VALUES(?,?,?,?,?)').run(formula,'Fórmula','formula',root,JSON.stringify(data));
    db.exec("CREATE TRIGGER reject_activity BEFORE UPDATE ON pages BEGIN SELECT RAISE(ABORT,'activity failure'); END");
    const existing={id:formula,name:'Fórmula',type:'formula',parent_id:root,data} as Schema.PageColumn;
    await expect(repo.compareAndUpdate(existing,{data:{formula:{...data.formula,source:'2',revision:2}}})).rejects.toThrow('activity failure');
    expect(db.prepare('SELECT data FROM page_columns WHERE id=?').get(formula)).toMatchObject({data:JSON.stringify(data)});
  }finally{db.close()}});
  it('returns per-cell errors when related schema limits are exceeded',async()=>{const {db,repo}=await fixture();try{
    for(let n=100;n<612;n++)db.prepare('INSERT INTO page_columns(id,name,type,parent_id,data) VALUES(?,?,?,?,?)').run(id(n),'Extra','text',target,'{}');
    const result=await repo.evaluateColumns(root,[{id:formula,source:'1'}],[row],owner);
    expect(result[formula]?.[row]).toMatchObject({ok:false,error:{code:'CONTEXT_LIMIT'}});
  }finally{db.close()}});
});
