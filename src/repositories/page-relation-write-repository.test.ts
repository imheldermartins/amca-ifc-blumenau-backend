import {DatabaseSync, type SQLInputValue} from 'node:sqlite';
import {readdir} from 'node:fs/promises';
import {beforeAll, describe, it, expect} from 'vitest';
import {PageRelationWriteRepository} from './page-relation-write-repository.js';
import {PageRelationRepository} from './page-relation-repository.js';
import type {Schema} from '@/db/schemas/index';

const id = (n: number) => `01M${String(n).padStart(23, '0')}` as NonEmptyString;
const owner=id(1), other=id(2), source=id(3), target=id(4), a=id(5), b=id(6), x=id(7), y=id(8), columnId=id(9);
let migrationStatements: string[];
beforeAll(async()=>{
  const names=(await readdir(new URL('../db/migrations/',import.meta.url))).filter(name=>name.endsWith('.ts')).sort();
  migrationStatements=await Promise.all(names.map(async name=>{
    const {migration}=await import(new URL('../db/migrations/'+name,import.meta.url).href);
    return 'BEGIN;'+migration.up.join(';')+';COMMIT;';
  }));
});
async function fixture() {
  const sqlite = new DatabaseSync(':memory:'); sqlite.exec('PRAGMA foreign_keys=ON');
  for (const sql of migrationStatements) sqlite.exec(sql);
  for (const user of [owner,other]) sqlite.prepare('INSERT INTO users(id,email) VALUES(?,?)').run(user, user+'@test.local');
  for (const page of [source,target,a,b,x,y]) sqlite.prepare('INSERT INTO pages(id,title,owner_id,data) VALUES(?,?,?,?)').run(page,page,owner,'{}');
  for (const [parent,child] of [[source,a],[source,b],[target,x],[target,y]]) sqlite.prepare('INSERT INTO page_edges(id,parent_id,child_id) VALUES(?,?,?)').run(child!,parent!,child!);
  const column = {id:columnId,name:'Pedidos',type:'relation',parent_id:source,data:{relation:{version:1,targetDatabaseId:target,cardinality:'many'}}} as Schema.PageColumn;
  sqlite.prepare('INSERT INTO page_columns(id,name,type,parent_id,data) VALUES(?,?,?,?,?)').run(column.id,column.name,column.type,column.parent_id,JSON.stringify(column.data));
  const execute=async<T>(query: string | SqlStatement)=>{
    const q=typeof query==='string'?{text:query,values:[]}:query;
    return sqlite.prepare(q.text).all(...q.values as SQLInputValue[]) as T[];
  };
  const commit = async(statements: RqliteStatement[]) => {
    sqlite.exec('BEGIN');
    try {
      const results=statements.map(s=>{const [text,...values]=typeof s==='string'?[s]:s; return Number(sqlite.prepare(String(text)).run(...values as SQLInputValue[]).changes)>0;});
      sqlite.exec('COMMIT');return results;
    } catch(error) {sqlite.exec('ROLLBACK');throw error;}
  };
  const repo=new PageRelationWriteRepository(execute,commit);
  const cell=(page: string, column=columnId)=>sqlite.prepare('SELECT * FROM page_columns_values WHERE page_id=? AND page_column_id=?').get(page,column) as unknown as Schema.PageColumnValue | undefined;
  const ids=(page: string,column=columnId)=>JSON.parse(cell(page,column)?.data ?? '{"value":[]}').value;
  const definition=(id: string)=>{const c=sqlite.prepare('SELECT * FROM page_columns WHERE id=?').get(id)!;return {...c,data:JSON.parse(String(c.data))} as unknown as Schema.PageColumn;};
  const pair=async(cardinality: 'one'|'many'='many')=>(await repo.saveDefinition(definition(columnId),column,{version:1,targetDatabaseId:target,bidirectional:true,inverseName:'Origem',inverseCardinality:cardinality},owner)).column;
  return {sqlite,repo,reader:new PageRelationRepository(execute),column,cell,ids,definition,pair};
}

describe('Relation snapshots, cardinality and SQL links',()=>{
  it('creates form relations and their inverse inside the response transaction',async()=>{
    const f=await fixture();try {
      const c=await f.pair(), row=id(80);
      const planned=await f.repo.prepareCreate(c,row,[x,y],owner);
      f.sqlite.exec('BEGIN');
      f.sqlite.prepare('INSERT INTO pages(id,owner_id,data) VALUES(?,?,?)').run(row,owner,'{}');
      f.sqlite.prepare('INSERT INTO page_edges(id,parent_id,child_id) VALUES(?,?,?)').run(row,source,row);
      for (const statement of planned) {
        const [sql,...values]=typeof statement==='string'?[statement]:statement;
        f.sqlite.prepare(String(sql)).run(...values as SQLInputValue[]);
      }
      f.sqlite.exec('COMMIT');
      expect(f.ids(row)).toEqual([x,y]);
      expect(f.ids(x,c.data.relation!.inverseColumnId!)).toEqual([row]);
      expect(f.ids(y,c.data.relation!.inverseColumnId!)).toEqual([row]);
      expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM page_relation_links').get()).toMatchObject({n:4});
      expect(f.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {f.sqlite.close();}
  });
  it('rolls back a new form response if a selected target changes destination before commit',async()=>{
    const f=await fixture();try {
      const c=await f.pair(), row=id(80);
      const planned=await f.repo.prepareCreate(c,row,[x],owner);
      f.sqlite.prepare('UPDATE page_edges SET parent_id=? WHERE child_id=?').run(source,x);
      f.sqlite.exec('BEGIN');
      try {
        f.sqlite.prepare('INSERT INTO pages(id,owner_id,data) VALUES(?,?,?)').run(row,owner,'{}');
        f.sqlite.prepare('INSERT INTO page_edges(id,parent_id,child_id) VALUES(?,?,?)').run(row,source,row);
        for (const statement of planned) {
          const [sql,...values]=typeof statement==='string'?[statement]:statement;
          f.sqlite.prepare(String(sql)).run(...values as SQLInputValue[]);
        }
        throw new Error('Expected the relation guard to reject');
      } catch(error) {
        f.sqlite.exec('ROLLBACK');
        expect(String(error)).toMatch(/constraint/i);
      }
      expect(f.sqlite.prepare('SELECT id FROM pages WHERE id=?').get(row)).toBeUndefined();
      expect(f.cell(x,c.data.relation!.inverseColumnId!)).toBeUndefined();
      expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM page_relation_links').get()).toMatchObject({n:0});
    } finally {f.sqlite.close();}
  });
  it('rejects form relations when the inverse cardinality is already filled',async()=>{
    const f=await fixture();try {
      const c=await f.pair('one');
      await f.repo.write(c,a,[x],owner,null);
      await expect(f.repo.prepareCreate(c,id(80),[x],owner)).rejects.toMatchObject({status:409});
      expect(f.ids(x,c.data.relation!.inverseColumnId!)).toEqual([a]);
    } finally {f.sqlite.close();}
  });
  it('searches and paginates only readable pages with active children, without requiring columns or a database flag',async()=>{
    const f=await fixture();try {
      const workspace=id(30), withoutColumns=id(31), child=id(32), archivedParent=id(33), archivedChild=id(34);
      f.sqlite.prepare('INSERT INTO workspaces(id,name,created_by_user_id) VALUES(?,?,?)').run(workspace,'Área',owner);
      f.sqlite.prepare('INSERT INTO workspace_members(id,workspace_id,user_id,page_root_id) VALUES(?,?,?,?)').run(id(35),workspace,owner,source);
      for (const [page,title] of [[withoutColumns,'Página com filhos'],[child,'Registro'],[archivedParent,'Pedidos arquivados'],[archivedChild,'Arquivado']]) {
        f.sqlite.prepare('INSERT INTO pages(id,title,owner_id,data) VALUES(?,?,?,?)').run(page!,title!,owner,'{}');
      }
      for (const [parent,page] of [[source,target],[source,withoutColumns],[withoutColumns,child],[source,archivedParent],[archivedParent,archivedChild]]) {
        f.sqlite.prepare('INSERT INTO page_edges(id,parent_id,child_id) VALUES(?,?,?)').run(page!,parent!,page!);
      }
      f.sqlite.prepare('UPDATE pages SET title=? WHERE id=?').run('Pedidos',target);
      f.sqlite.prepare('UPDATE pages SET title=? WHERE id=?').run('Pedidos normal',a);
      f.sqlite.prepare('UPDATE pages SET deleted_at=CURRENT_TIMESTAMP WHERE id=?').run(archivedChild);
      const first=await f.reader.listDatabases(workspace,owner,undefined,undefined,1);
      expect(first).toEqual({items:[{id:source,title:source}],nextCursor:source});
      const second=await f.reader.listDatabases(workspace,owner,undefined,first.nextCursor!,1);
      expect(second).toEqual({items:[{id:target,title:'Pedidos'}],nextCursor:target});
      expect(await f.reader.listDatabases(workspace,owner,undefined,second.nextCursor!,1)).toEqual({items:[{id:withoutColumns,title:'Página com filhos'}],nextCursor:null});
      expect(await f.reader.listDatabases(workspace,owner,'pedidos')).toEqual({items:[{id:target,title:'Pedidos'}],nextCursor:null});
      expect(await f.reader.listDatabases(workspace,other)).toEqual({items:[],nextCursor:null});
      expect(f.sqlite.prepare('SELECT COUNT(*) AS total FROM page_columns WHERE parent_id=?').get(withoutColumns)).toMatchObject({total:0});
      await expect(f.reader.validateRelationConfig(source,{version:1,targetDatabaseId:a},owner)).rejects.toThrow('página com filhos');
      await expect(f.reader.validateRelationConfig(source,{version:1,targetDatabaseId:withoutColumns},owner)).resolves.toBeUndefined();
    } finally {f.sqlite.close();}
  });
  it('scopes options, search and pagination to direct children of the configured destination',async()=>{
    const f=await fixture();try {
      f.sqlite.prepare('UPDATE pages SET title=? WHERE id=?').run('Sabonete Dove',b);
      f.sqlite.prepare('UPDATE pages SET title=? WHERE id=?').run('20/10/2026',x);
      const first=await f.reader.listOptions(target,owner,undefined,undefined,1);
      expect(first).toEqual({items:[{id:x,title:'20/10/2026'}],nextCursor:x});
      expect(await f.reader.listOptions(target,owner,undefined,first.nextCursor!,1)).toEqual({items:[{id:y,title:y}],nextCursor:null});
      expect(await f.reader.listOptions(target,owner,'Sabonete')).toEqual({items:[],nextCursor:null});
      expect((await f.reader.listOptions(target,owner,'20/10')).items).toEqual([{id:x,title:'20/10/2026'}]);
      expect(await f.reader.listOptions(target,other)).toEqual({items:[],nextCursor:null});
    } finally {f.sqlite.close();}
  });
  it('rejects a page from another base before writing even when it is readable in the same workspace',async()=>{
    const f=await fixture();try {
      const root=id(30);
      f.sqlite.prepare('INSERT INTO pages(id,owner_id,data) VALUES(?,?,?)').run(root,owner,'{}');
      f.sqlite.prepare('INSERT INTO workspaces(id,created_by_user_id) VALUES(?,?)').run(root,owner);
      f.sqlite.prepare('INSERT INTO workspace_members(id,workspace_id,user_id,page_root_id) VALUES(?,?,?,?)').run(id(31),root,owner,root);
      for (const [edge,child] of [[id(32),source],[id(33),target]]) {
        f.sqlite.prepare('INSERT INTO page_edges(id,parent_id,child_id) VALUES(?,?,?)').run(edge!,root,child!);
      }
      await expect(f.reader.prepareRelationTargets(f.column,a,[x],owner)).resolves.toEqual([x]);
      await expect(f.reader.prepareRelationTargets(f.column,a,[x,b],owner)).rejects.toMatchObject({
        status:400,message:'Uma ou mais páginas não pertencem à database de destino ou não estão acessíveis',
      });
      expect(f.cell(a)).toBeUndefined();
    } finally {f.sqlite.close();}
  });
  it.each([false,true])('atomically rejects cross-base targets in the write transaction (bidirectional=%s)',async(bidirectional)=>{
    const f=await fixture();try {
      const c=bidirectional?await f.pair():f.column;
      await f.repo.write(c,a,[x],owner,null);
      const before=f.sqlite.prepare('SELECT * FROM page_relation_links ORDER BY source_cell_id,target_page_id').all();
      await expect(f.repo.write(c,a,[x,b],owner,f.cell(a)!)).rejects.toMatchObject({status:409});
      expect(f.ids(a)).toEqual([x]);
      expect(f.sqlite.prepare('SELECT * FROM page_relation_links ORDER BY source_cell_id,target_page_id').all()).toEqual(before);
      if (c.data.relation!.inverseColumnId) {
        expect(f.ids(x,c.data.relation!.inverseColumnId)).toEqual([a]);
        expect(f.cell(b,c.data.relation!.inverseColumnId)).toBeUndefined();
      }
    } finally {f.sqlite.close();}
  });
  it('creates the inverse only when enabled and synchronizes additions/removals from either side',async()=>{
    const f=await fixture();try {
      const sourceColumn=await f.pair(); const inverse=f.definition(sourceColumn.data.relation!.inverseColumnId!);
      await f.repo.write(sourceColumn,a,[x,y],owner,null);
      expect(f.ids(x,inverse.id)).toEqual([a]);expect(f.ids(y,inverse.id)).toEqual([a]);
      await f.repo.write(inverse,x,[b],owner,f.cell(x,inverse.id)!);
      expect(f.ids(a)).toEqual([y]);expect(f.ids(b)).toEqual([x]);expect(f.ids(x,inverse.id)).toEqual([b]);
      expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM page_relation_links').get()).toMatchObject({n:4});
      expect(f.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {f.sqlite.close();}
  });
  it('enforces N:1 on the inverse and rolls back the entire attempted link',async()=>{
    const f=await fixture();try {
      const c=await f.pair('one'), inverse=c.data.relation!.inverseColumnId!;
      await f.repo.write(c,a,[x],owner,null);
      await expect(f.repo.write(c,b,[x],owner,null)).rejects.toThrow('somente uma');
      expect(f.cell(b)).toBeUndefined();expect(f.ids(x,inverse)).toEqual([a]);
      expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM page_relation_links').get()).toMatchObject({n:2});
    } finally {f.sqlite.close();}
  });
  it('backfills an inverse and refuses a one-page limit without discarding existing links',async()=>{
    const f=await fixture();try {
      await f.repo.write(f.column,a,[x,y],owner,null);
      const c=await f.pair(), inverse=c.data.relation!.inverseColumnId!;
      expect(f.ids(y,inverse)).toEqual([a]);
      await expect(f.repo.saveDefinition(c,{...c,data:{...c.data,relation:{...c.data.relation!,cardinality:'one'}}},undefined,owner)).rejects.toThrow('várias páginas');
      expect(f.ids(a)).toEqual([x,y]);expect(f.definition(c.id).data.relation!.cardinality).toBe('many');
    } finally {f.sqlite.close();}
  });
  it('preserves both properties and their snapshots when bidirectionality is disabled',async()=>{
    const f=await fixture();try {
      const c=await f.pair(), inverse=c.data.relation!.inverseColumnId!;
      await f.repo.write(c,a,[x],owner,null);
      const {column: independent}=await f.repo.saveDefinition(c,c,{version:1,targetDatabaseId:target,bidirectional:false},owner);
      expect(independent.data.relation!.inverseColumnId).toBeUndefined();
      expect(f.definition(inverse).data.relation!.inverseColumnId).toBeUndefined();
      await f.repo.write(independent,a,[],owner,f.cell(a)!);
      expect(f.ids(x,inverse)).toEqual([a]);
    } finally {f.sqlite.close();}
  });
  it('rejects stale cell snapshots so a concurrent edit cannot erase a link',async()=>{
    const f=await fixture();try {
      const c=await f.pair(), inverse=c.data.relation!.inverseColumnId!;
      const stale=await f.repo.write(c,a,[x],owner,null);
      await f.repo.write(c,a,[x,y],owner,stale);
      await expect(f.repo.write(c,a,[],owner,stale)).rejects.toThrow('alterada');
      expect(f.ids(a)).toEqual([x,y]);expect(f.ids(x,inverse)).toEqual([a]);expect(f.ids(y,inverse)).toEqual([a]);
    } finally {f.sqlite.close();}
  });
  it('does not mutate an inverse cell without edit permission or when it is locked',async()=>{
    const f=await fixture();try {
      const c=await f.pair(), inverse=c.data.relation!.inverseColumnId!;
      f.sqlite.prepare('UPDATE pages SET data=? WHERE id=?').run(JSON.stringify({columnLocks:{[inverse]:{userIds:[other]}}}),target);
      await expect(f.repo.write(c,a,[x],owner,null)).rejects.toThrow('bloqueada');
      expect(f.cell(a)).toBeUndefined();expect(f.cell(x,inverse)).toBeUndefined();
      f.sqlite.prepare("UPDATE pages SET data='{}',owner_id=? WHERE id=?").run(other,target);
      f.sqlite.prepare('UPDATE pages SET owner_id=? WHERE id=?').run(other,x);
      await expect(f.repo.write(c,a,[x],owner,null)).rejects.toThrow('permissão');
    } finally {f.sqlite.close();}
  });
  it('deletes both directions and keeps the SQL index in sync',async()=>{
    const f=await fixture();try {
      const c=await f.pair(), inverse=c.data.relation!.inverseColumnId!;
      await f.repo.write(c,a,[x],owner,null);
      await f.repo.write(c,a,[],owner,f.cell(a)!,true);
      expect(f.cell(a)).toBeUndefined();expect(f.ids(x,inverse)).toEqual([]);
      expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM page_relation_links').get()).toMatchObject({n:0});
    } finally {f.sqlite.close();}
  });
  it('enforces the one-page limit inside SQL, including a concurrent configuration change',async()=>{
    const f=await fixture();try {
      const c={...f.column,data:{relation:{...f.column.data.relation!,cardinality:'one' as const}}};
      await f.repo.saveDefinition(f.column,c,undefined,owner);
      expect(()=>f.sqlite.prepare('INSERT INTO page_columns_values(id,page_id,page_column_id,data) VALUES(?,?,?,?)').run(id(20),a,c.id,JSON.stringify({value:[x,y]}))).toThrow('relation_cardinality_one');
      await expect(f.repo.write(f.column,a,[x,y],owner,null)).rejects.toThrow('alterada');
      expect(f.cell(a)).toBeUndefined();
    } finally {f.sqlite.close();}
  });
});
