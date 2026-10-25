import {DatabaseSync,type SQLInputValue} from 'node:sqlite';
import {readdir} from 'node:fs/promises';
import {describe,it,expect,vi} from 'vitest';
import formulas,{PageFormulaRepository, type FormulaCommit} from './page-formula-repository.js';
import {PageFormulaController} from '@/controllers/page-formula-controller';
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
  const query=vi.fn<(statement:string|SqlStatement)=>void>();
  const repo=new PageFormulaRepository(<T>(statement:string|SqlStatement)=>{query(statement);return execute<T>(statement)},commit);
  const addRow=(pageId:string,databaseId=root)=>{
    db.prepare('INSERT INTO pages(id,title,owner_id,data) VALUES(?,?,?,?)').run(pageId,'Outra',owner,'{}');
    db.prepare('INSERT INTO page_edges(id,parent_id,child_id) VALUES(?,?,?)').run(pageId,databaseId,pageId);
  };
  return {db,repo,query,addRow};
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

describe('Canonical formula index',()=>{
  it('validates sample previews and computes real page previews using the authorized context',async()=>{
    const {db,repo,addRow}=await fixture();
    const catalog=vi.spyOn(formulas,'catalog').mockImplementation(repo.catalog.bind(repo));
    const evaluate=vi.spyOn(formulas,'evaluate').mockImplementation(repo.evaluate.bind(repo));
    try{
      addRow(id(0));
      const controller=new PageFormulaController();
      const sample=await controller.preview(root,owner,{source:'index()'});
      expect(sample).toMatchObject({ok:true,data:{ok:true,valueType:{kind:'number'}}});
      if(sample.ok)expect(sample.data).not.toHaveProperty('result');
      expect(evaluate).not.toHaveBeenCalled();
      expect(await controller.preview(root,owner,{source:'padStart(toText(index()), 3, "0")',pageId:row})).toMatchObject({ok:true,data:{ok:true,result:{ok:true,value:'002'}}});
      expect(await controller.preview(root,other,{source:'index()',pageId:row})).toMatchObject({ok:true,data:{ok:true,result:{ok:false,error:{code:'ACCESS'}}}});
    }finally{catalog.mockRestore();evaluate.mockRestore();db.close()}
  });
  it('ranks the entire database once per batch, independently of requested windows or view order',async()=>{
    const {db,repo,query,addRow}=await fixture();try{
      for(let n=100;n<360;n++)addRow(id(n));
      const definition=await repo.definition(root,owner,{version:1,source:'index()'});
      expect(definition.resultType).toEqual({kind:'number'});
      query.mockClear();
      expect(await repo.evaluate(root,definition.source,formula,[id(359),row],owner)).toMatchObject({[row]:{ok:true,value:1},[id(359)]:{ok:true,value:261}});
      expect(query.mock.calls.filter(([statement])=>typeof statement!=='string'&&statement.text.includes('ROW_NUMBER()'))).toHaveLength(1);
      expect(await repo.evaluate(root,'index()',formula,[id(359)],owner)).toMatchObject({[id(359)]:{ok:true,value:261}});
      for(const [view,first,last] of [[id(80),'a0','a1'],[id(81),'a1','a0']]){
        db.prepare('INSERT INTO page_view_row_order(id,edge_id,view_id,rank) VALUES(?,?,?,?)').run(id(view===id(80)?82:84),row,view!,first!);
        db.prepare('INSERT INTO page_view_row_order(id,edge_id,view_id,rank) VALUES(?,?,?,?)').run(id(view===id(80)?83:85),id(359),view!,last!);
      }
      db.prepare('UPDATE pages SET data=? WHERE id=?').run(JSON.stringify({[id(80)]:{filters:{clauses:[{columnId:number,operator:'greaterThan',value:100}]}}}),root);
      expect(await repo.evaluate(root,'index()',formula,[id(359)],owner)).toMatchObject({[id(359)]:{ok:true,value:261}});
      query.mockClear();await repo.evaluate(root,'1',formula,[row],owner);
      expect(query.mock.calls.some(([statement])=>typeof statement!=='string'&&statement.text.includes('ROW_NUMBER()'))).toBe(false);
    }finally{db.close()}
  });
  it('recalculates dense positions after insertion, deletion and restoration',async()=>{
    const {db,repo,addRow}=await fixture();try{
      addRow(id(20));
      expect(await repo.evaluate(root,'index()',formula,[row,id(20)],owner)).toMatchObject({[row]:{ok:true,value:1},[id(20)]:{ok:true,value:2}});
      addRow(id(0));
      expect(await repo.evaluate(root,'index()',formula,[row,id(20)],owner)).toMatchObject({[row]:{ok:true,value:2},[id(20)]:{ok:true,value:3}});
      db.prepare('UPDATE pages SET deleted_at=CURRENT_TIMESTAMP WHERE id=?').run(id(0));
      expect(await repo.evaluate(root,'index()',formula,[id(20)],owner)).toMatchObject({[id(20)]:{ok:true,value:2}});
      db.prepare('UPDATE pages SET deleted_at=NULL WHERE id=?').run(id(0));
      expect(await repo.evaluate(root,'index()',formula,[id(20)],owner)).toMatchObject({[id(20)]:{ok:true,value:3}});
    }finally{db.close()}
  });
  it('uses database positions inside relations and referenced formulas',async()=>{
    const {db,repo,addRow}=await fixture();try{
      addRow(id(0),target);addRow(id(20),target);addRow(id(21),target);
      db.prepare('UPDATE page_columns_values SET data=? WHERE id=?').run(JSON.stringify({value:[id(21),order]}),relation);
      expect(await repo.evaluate(root,'map(@Pedidos,index())',formula,[row],owner)).toMatchObject({[row]:{ok:true,value:[4,2]}});
      expect(await repo.evaluate(root,'map(filter(@Pedidos,index()>2),index()).sum()',formula,[row],owner)).toMatchObject({[row]:{ok:true,value:4}});
      db.prepare('INSERT INTO page_columns(id,name,type,parent_id,data) VALUES(?,?,?,?,?)').run(formula,'Posição','formula',target,JSON.stringify({formula:{version:1,source:'index()',revision:1}}));
      expect(await repo.evaluate(root,'map(@Pedidos,@Posição).sum()',undefined,[row],owner)).toMatchObject({[row]:{ok:true,value:6}});
      expect(await repo.evaluate(root,'index()',undefined,[order],owner)).toMatchObject({[order]:{ok:false,error:{code:'SCOPE'}}});
    }finally{db.close()}
  });
  it('authorizes before ranking and renumbers when access changes',async()=>{
    const {db,repo,addRow}=await fixture();try{
      addRow(id(20));addRow(id(21));
      const allow=id(70),deny=id(71);
      db.prepare('INSERT INTO page_roles(id,page_id,name,roles) VALUES(?,?,?,?)').run(allow,root,'Leitor',JSON.stringify({read:['view','subpages'],write:[]}));
      db.prepare('INSERT INTO page_collaborators(id,page_id,user_id,page_member_role_id) VALUES(?,?,?,?)').run(id(72),root,other,allow);
      db.prepare('INSERT INTO page_roles(id,page_id,name,roles) VALUES(?,?,?,?)').run(deny,row,'Sem acesso',JSON.stringify({read:[],write:[]}));
      db.prepare('INSERT INTO page_collaborators(id,page_id,user_id,page_member_role_id) VALUES(?,?,?,?)').run(id(73),row,other,deny);
      expect(await repo.evaluate(root,'index()',formula,[id(20),id(21)],other)).toMatchObject({[id(20)]:{ok:true,value:1},[id(21)]:{ok:true,value:2}});
      expect(await repo.evaluate(root,'index()',formula,[row],other)).toMatchObject({[row]:{ok:false,error:{code:'ACCESS'}}});
      expect(await repo.evaluate(root,'index()',formula,[id(21)],owner)).toMatchObject({[id(21)]:{ok:true,value:3}});
      db.prepare('UPDATE page_collaborators SET deleted_at=CURRENT_TIMESTAMP WHERE id=?').run(id(73));
      expect(await repo.evaluate(root,'index()',formula,[id(21)],other)).toMatchObject({[id(21)]:{ok:true,value:3}});
    }finally{db.close()}
  });
});
