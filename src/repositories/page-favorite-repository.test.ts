import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readdir } from 'node:fs/promises';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { RqliteClient } from '@cubs/rqlite-client';
import { createLegacyTransport } from '@cubs/rqlite-client/compat';
import { PageFavoriteStore } from './page-favorite-repository.js';
import { PageFavoriteController } from '@/controllers/page-favorite-controller';

const id = (n: number) => `01M${String(n).padStart(23, '0')}`;
const actor=id(1), other=id(2), root=id(10), a=id(11), b=id(12), secret=id(13), shared=id(14), workspace=id(20);
let sql: DatabaseSync, store: PageFavoriteStore;
const requests = vi.fn<typeof fetch>();
beforeEach(async () => {
  sql = new DatabaseSync(':memory:'); sql.exec('PRAGMA foreign_keys=ON');
  for (const file of (await readdir(new URL('../db/migrations/', import.meta.url))).filter((name) => name.endsWith('.ts')).sort()) {
    const { migration } = await import(new URL(`../db/migrations/${file}`, import.meta.url).href);
    sql.exec(`BEGIN;${migration.up.join(';')};COMMIT;`);
  }
  for (const user of [actor,other]) sql.prepare('INSERT INTO users(id,email) VALUES(?,?)').run(user,`${user}@test.local`);
  for (const [page,owner,title] of [[root,actor,'Raiz'],[a,actor,'Primeira'],[b,actor,'Segunda'],[secret,other,'Segredo'],[shared,other,'Compartilhada']]) {
    sql.prepare('INSERT INTO pages(id,owner_id,title,data) VALUES(?,?,?,?)').run(page!,owner!,title!,'{}');
  }
  for (const [parent,child] of [[root,a],[root,b],[secret,shared]]) sql.prepare('INSERT INTO page_edges(id,parent_id,child_id) VALUES(?,?,?)').run(child!,parent!,child!);
  sql.prepare('INSERT INTO workspaces(id,name,created_by_user_id) VALUES(?,?,?)').run(workspace,'Minha área',actor);
  sql.prepare('INSERT INTO workspaces(id,name,created_by_user_id) VALUES(?,?,?)').run(id(21),'Área privada',other);
  sql.prepare('INSERT INTO workspace_members(id,workspace_id,user_id,page_root_id) VALUES(?,?,?,?)').run(id(30),workspace,actor,root);
  sql.prepare('INSERT INTO workspace_members(id,workspace_id,user_id,page_root_id) VALUES(?,?,?,?)').run(id(31),id(21),other,secret);
  sql.prepare('INSERT INTO page_roles(id,page_id,name,roles) VALUES(?,?,?,?)').run(id(40),shared,'Leitor',JSON.stringify({read:['view'],write:[]}));
  sql.prepare('INSERT INTO page_collaborators(id,page_id,user_id,page_member_role_id) VALUES(?,?,?,?)').run(id(41),shared,actor,id(40));
  requests.mockReset();
  requests.mockImplementation(async (input, options) => {
    const url = new URL(String(input));
    expect(url.pathname).toBe('/db/request');
    expect(url.searchParams.has('transaction')).toBe(true);
    const statements = JSON.parse(String(options?.body)) as [string, ...SQLInputValue[]][];
    sql.exec('BEGIN');
    try {
      const results = statements.map(([text, ...values]) => {
        const statement = sql.prepare(text);
        if (/^\s*SELECT\b/i.test(text)) return { types: { favorite: 'integer' }, rows: statement.all(...values) };
        // Match rqlite's write response, which does not return inserted rows.
        const result = statement.run(...values);
        return { rows_affected: Number(result.changes), rows: null };
      });
      sql.exec('COMMIT');
      return Response.json({ results });
    } catch (error) { sql.exec('ROLLBACK'); throw error; }
  });
  const transport = createLegacyTransport(new RqliteClient({ url: 'http://rqlite.test', fetch: requests }));
  store = new PageFavoriteStore(async <T>(statement: string | SqlStatement) => {
    const query = typeof statement === 'string' ? { text: statement, values: [] } : statement;
    return sql.prepare(query.text).all(...query.values as SQLInputValue[]) as T[];
  }, transport.rqlite);
});
afterEach(() => sql.close());

describe('personal page favorites', () => {
  it('confirms a persisted favorite when rqlite returns only affected rows, including repeated requests', async () => {
    const controller = new PageFavoriteController(store);
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(await controller.set(actor, a, true)).toEqual({ status: 200, data: { pageId: a, favorite: true } });
      expect(await controller.state(actor, a)).toEqual({ status: 200, data: { pageId: a, favorite: true } });
    }
    expect((await store.list(actor, 50)).items.map((item) => item.pageId)).toEqual([a]);
    expect(await controller.set(actor, a, false)).toEqual({ status: 200, data: { pageId: a, favorite: false } });
    expect(await store.state(actor, a)).toBe(false);
  });
  it('adds a readable page idempotently without changing its content or granting page write access', async () => {
    const before = sql.prepare('SELECT * FROM pages ORDER BY id').all();
    expect(await store.add(actor,shared)).toBe(true); expect(await store.add(actor,shared)).toBe(true);
    expect(await store.state(actor,shared)).toBe(true);
    expect(sql.prepare('SELECT COUNT(*) AS n FROM page_favorites WHERE user_id=?').get(actor)).toMatchObject({n:1});
    expect(sql.prepare('SELECT * FROM pages ORDER BY id').all()).toEqual(before);
    expect(sql.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
  it('filters revoked and deleted pages before pagination and does not disclose private workspace metadata', async () => {
    for (const page of [a,b,shared]) await store.add(actor,page);
    expect(await store.add(actor,secret)).toBe(false);
    sql.prepare('INSERT INTO page_favorites(id,user_id,page_id) VALUES(?,?,?)').run(id(50),actor,secret);
    await store.add(other,secret);
    const list = await store.list(actor,50);
    expect(list.total).toBe(3); expect(list.items.map((item)=>item.pageId).sort()).toEqual([a,b,shared].sort());
    expect(list.items.find((item)=>item.pageId===a)).toMatchObject({workspaceId:workspace,workspaceName:'Minha área'});
    expect(list.items.find((item)=>item.pageId===shared)).toMatchObject({workspaceId:null,workspaceName:null});
    sql.prepare('UPDATE pages SET deleted_at=CURRENT_TIMESTAMP WHERE id=?').run(a);
    sql.prepare('UPDATE page_collaborators SET deleted_at=CURRENT_TIMESTAMP WHERE id=?').run(id(41));
    expect((await store.list(actor,1)).items.map((item)=>item.pageId)).toEqual([b]);
    expect((await store.list(actor,1)).total).toBe(1);
    expect(await store.state(actor,shared)).toBeNull(); expect(await store.add(actor,a)).toBe(false);
  });
  it('uses a stable cursor for same-second favorites and never duplicates or skips a page', async () => {
    for (const page of [root,a,b,shared]) await store.add(actor,page);
    const controller = new PageFavoriteController(store), found: string[] = [];
    let cursor: string | undefined;
    do {
      const response = await controller.list(actor,{limit:'1',...(cursor?{cursor}:{})});
      expect(response.status).toBe(200);
      const page = response.data as Awaited<ReturnType<PageFavoriteStore['list']>>;
      expect(page.total).toBe(4); found.push(...page.items.map((item)=>item.pageId)); cursor=page.nextCursor??undefined;
    } while(cursor);
    expect(found).toHaveLength(4); expect(new Set(found)).toEqual(new Set([root,a,b,shared]));
  });
  it('removes only the caller bookmark even after access is lost, and cascades on physical page deletion', async () => {
    await store.add(actor,shared); await store.add(other,shared);
    sql.prepare('UPDATE page_collaborators SET deleted_at=CURRENT_TIMESTAMP WHERE id=?').run(id(41));
    await store.remove(actor,shared); await store.remove(actor,shared);
    expect(sql.prepare('SELECT user_id FROM page_favorites WHERE page_id=?').all(shared)).toEqual([{user_id:other}]);
    await store.add(actor,a);
    sql.prepare('DELETE FROM page_edges WHERE child_id=?').run(a); sql.prepare('DELETE FROM pages WHERE id=?').run(a);
    expect(sql.prepare('SELECT COUNT(*) AS n FROM page_favorites WHERE page_id=?').get(a)).toMatchObject({n:0});
  });
  it('validates public query inputs and does not trust a caller-supplied owner', async () => {
    const controller = new PageFavoriteController(store);
    for (const query of [{limit:'0'},{limit:'51'},{cursor:'invalid'},{userId:other}, {limit:['1']}]) expect((await controller.list(actor,query)).status).toBe(400);
    expect((await controller.set(actor,'invalid',true)).status).toBe(400);
    expect((await controller.set(actor,secret,true)).status).toBe(404);
    expect((await controller.state(actor,secret)).status).toBe(404);
    expect((await store.list(other,50)).items).toEqual([]);
  });
});
