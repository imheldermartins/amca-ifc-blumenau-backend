import {DatabaseSync, type SQLInputValue} from 'node:sqlite';
import {readdir} from 'node:fs/promises';
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({find: vi.fn(), columns: vi.fn(), sql: vi.fn(), transport: vi.fn()}));
vi.mock('@models/index', () => ({default: {pages: {find: mocks.find}, pageColumns: {findAll: mocks.columns}, sqlRaw: mocks.sql}}));
vi.mock('@/db/client-db', () => ({rqlite: mocks.transport}));
import {PageHierarchyStore} from './page-hierarchy-repository.js';
import {PageChildInputError} from './page-child-values.js';
import {PageColumnController} from '@/controllers/page-column-controller';
import type {Schema} from '@/db/schemas/index';

const id = (n: number) => `01M${String(n).padStart(23, '0')}` as NonEmptyString;
const owner = id(1), parent = id(2), dateId = id(3), textId = id(4), numberId = id(5), relationId = id(6), target = id(7), targetChild = id(8);
let sqlite: DatabaseSync;
let migrations: string[];
let beforeCommit: (() => void) | undefined;
beforeAll(async () => {
  const names = (await readdir(new URL('../db/migrations/', import.meta.url))).filter(name => name.endsWith('.ts')).sort();
  migrations = await Promise.all(names.map(async name => {
    const {migration} = await import(new URL('../db/migrations/' + name, import.meta.url).href);
    return 'BEGIN;' + migration.up.join(';') + ';COMMIT;';
  }));
});
beforeEach(() => {
  sqlite = new DatabaseSync(':memory:'); sqlite.exec('PRAGMA foreign_keys=ON');
  migrations.forEach(sql => sqlite.exec(sql));
  sqlite.prepare('INSERT INTO users(id,email) VALUES(?,?)').run(owner, 'calendar@test.local');
  sqlite.prepare('INSERT INTO users(id,email) VALUES(?,?)').run(id(43), 'member@test.local');
  for (const page of [parent, target, targetChild]) sqlite.prepare('INSERT INTO pages(id,owner_id,data) VALUES(?,?,?)').run(page, owner, '{}');
  sqlite.prepare('INSERT INTO page_edges(id,parent_id,child_id) VALUES(?,?,?)').run(id(11), target, targetChild);
  sqlite.prepare('INSERT INTO workspaces(id,name,created_by_user_id) VALUES(?,?,?)').run(id(40), 'Calendar', owner);
  for (const root of [parent, target]) sqlite.prepare('INSERT INTO workspace_members(id,workspace_id,user_id,page_root_id) VALUES(?,?,?,?)').run(id(root === parent ? 41 : 42), id(40), root === parent ? owner : id(43), root);
  for (const [columnId, type, data] of [[dateId, 'date', {}], [textId, 'text', {}], [numberId, 'numeric', {}], [relationId, 'relation', {relation: {version: 1, targetDatabaseId: target, cardinality: 'many'}}]] as const) {
    sqlite.prepare('INSERT INTO page_columns(id,name,type,parent_id,data) VALUES(?,?,?,?,?)').run(columnId, type, type, parent, JSON.stringify(data));
  }
  const query = (text: string, values: unknown[] = []) => sqlite.prepare(text).all(...values as SQLInputValue[]);
  mocks.find.mockImplementation(async ({id}: {id: string}) => {const row = query('SELECT * FROM pages WHERE id=?', [id])[0]; return row ? {...row, data: JSON.parse(String(row.data))} : null});
  mocks.columns.mockImplementation(async () => query('SELECT * FROM page_columns WHERE deleted_at IS NULL').map(row => ({...row, data: JSON.parse(String(row.data))})));
  mocks.sql.mockImplementation(async (sql: SqlStatement) => query(sql.text, sql.values));
  mocks.transport.mockImplementation(async (statements: RqliteStatement[], _endpoint: string, options?: {transaction?: boolean}) => {
    if (options?.transaction) {beforeCommit?.(); beforeCommit = undefined; sqlite.exec('BEGIN')}
    try {
      const result = statements.map(statement => {
        const [text, ...values] = typeof statement === 'string' ? [statement] : statement;
        const prepared = sqlite.prepare(String(text));
        return /^\s*(SELECT|WITH|PRAGMA)/i.test(String(text)) ? prepared.all(...values as SQLInputValue[]) : prepared.run(...values as SQLInputValue[]).changes > 0;
      });
      if (options?.transaction) sqlite.exec('COMMIT');
      return result;
    } catch (error) {if (options?.transaction) sqlite.exec('ROLLBACK'); throw error}
  });
});
afterEach(() => {beforeCommit = undefined; sqlite.close(); vi.clearAllMocks()});

describe('calendar child transaction', () => {
  it('creates page, edge, role and typed cells together, retaining quotes and false values', async () => {
    const page = await new PageHierarchyStore().createChild(parent, owner, {title: 'Agenda', values: {[dateId]: '2026-10-27T09:30:00.000Z@2026-10-27T10:00:00.000Z', [textId]: "Reunião d'água", [numberId]: 0}});
    expect(page?.title).toBe('Agenda');
    expect(sqlite.prepare('SELECT child_id FROM page_edges WHERE parent_id=?').get(parent)?.child_id).toBe(page?.id);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM page_roles WHERE page_id=?').get(page!.id)?.n).toBe(1);
    const cells = sqlite.prepare('SELECT page_column_id,data FROM page_columns_values WHERE page_id=?').all(page!.id);
    expect(cells).toHaveLength(3);
    expect(cells.find(cell => cell.page_column_id === textId)?.data).toBe(JSON.stringify({value: "Reunião d'água"}));
  });
  it('rejects invalid values and foreign columns before leaving a child', async () => {
    for (const values of [{[dateId]: '2026-10-27'}, {[numberId]: '42'}, {[id(30)]: 'outside'}]) {
      await expect(new PageHierarchyStore().createChild(parent, owner, {values})).rejects.toBeInstanceOf(PageChildInputError);
    }
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM page_edges WHERE parent_id=?').get(parent)?.n).toBe(0);
  });
  it('rolls the whole creation back if a lock changes between validation and commit', async () => {
    // appendCreatedRowOrderStatements is a read before the transactional commit.
    let calls = 0;
    mocks.transport.mockImplementationOnce(async () => {
      beforeCommit = () => sqlite.prepare('UPDATE pages SET data=? WHERE id=?').run(JSON.stringify({columnLocks: {[dateId]: {userIds: [id(99)]}}}), parent);
      calls++;
      return [[{data: '{}'}]];
    });
    await expect(new PageHierarchyStore().createChild(parent, owner, {values: {[dateId]: '2026-10-27T00:00:00.000Z'}})).rejects.toThrow();
    expect(calls).toBe(1);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM page_edges WHERE parent_id=?').get(parent)?.n).toBe(0);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM pages').get()?.n).toBe(3);
  });
  it('creates relations through the canonical planner and its link index', async () => {
    const page = await new PageHierarchyStore().createChild(parent, owner, {values: {[relationId]: [targetChild]}});
    expect(page).toBeTruthy();
    expect(sqlite.prepare('SELECT target_page_id FROM page_relation_links WHERE source_cell_id IN (SELECT id FROM page_columns_values WHERE page_id=?)').get(page!.id)?.target_page_id).toBe(targetChild);
  });
  it('rolls back creation when the persisted row order changes before commit', async () => {
    const viewId = id(70);
    sqlite.prepare('UPDATE pages SET data=? WHERE id=?').run(JSON.stringify({[viewId]: {view: 'calendar', rowOrder: {version: 2, revision: 0}}}), parent);
    beforeCommit = () => sqlite.prepare('UPDATE pages SET data=json_set(data, ?, 1) WHERE id=?').run(`$."${viewId}".rowOrder.revision`, parent);
    await expect(new PageHierarchyStore().createChild(parent, owner, {values: {[dateId]: '2026-10-27T00:00:00.000Z'}})).rejects.toThrow();
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM page_edges WHERE parent_id=?').get(parent)?.n).toBe(0);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM pages').get()?.n).toBe(3);
  });
  it('rejects computed properties and unauthorized parent creation without partial pages', async () => {
    sqlite.prepare("UPDATE page_columns SET type='formula' WHERE id=?").run(numberId);
    await expect(new PageHierarchyStore().createChild(parent, owner, {values: {[numberId]: 9}})).rejects.toBeInstanceOf(PageChildInputError);
    await expect(new PageHierarchyStore().createChild(parent, id(43), {values: {[textId]: 'forbidden'}})).rejects.toThrow();
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM page_edges WHERE parent_id=?').get(parent)?.n).toBe(0);
  });
  it('ensures one scheduling property under concurrent requests and reuses its alias', async () => {
    const controller = new PageColumnController();
    const create = vi.spyOn(controller, 'createColumn').mockImplementation(async () => {
      const column: Schema.PageColumn = {id: id(90), name: 'Agendado para', type: 'date', parent_id: parent, data: {publicKey: {key: 'agendado_para', aliases: []}}, created_at: '2026-10-27T00:00:00.000Z', updated_at: '2026-10-27T00:00:00.000Z', deleted_at: null};
      sqlite.prepare('INSERT INTO page_columns(id,name,type,parent_id,data) VALUES(?,?,?,?,?)').run(column.id,column.name,column.type,parent,JSON.stringify(column.data));
      return {ok: true, data: column};
    });
    const results = await Promise.all([controller.ensureCalendarDate(parent, owner), controller.ensureCalendarDate(parent, owner)]);
    expect(results.every(result => result.ok && result.data.id === id(90))).toBe(true);
    expect(create).toHaveBeenCalledOnce();
    expect(sqlite.prepare("SELECT json_extract(data,'$.schedule.dateColumnId') AS id FROM pages WHERE id=?").get(parent)?.id).toBe(id(90));
    sqlite.prepare('UPDATE page_columns SET data=? WHERE id=?').run(JSON.stringify({publicKey: {key: 'renomeada', aliases: ['agendado_para']}}),id(90));
    expect(await controller.ensureCalendarDate(parent,owner)).toMatchObject({ok: true, reused: true, data: {id: id(90)}});
    expect(create).toHaveBeenCalledOnce();
    sqlite.prepare('UPDATE page_columns SET name=?, data=? WHERE id=?').run('Nova descrição', JSON.stringify({publicKey: {key: 'outra_chave', aliases: []}}),id(90));
    expect(await controller.ensureCalendarDate(parent, owner)).toMatchObject({ok: true, reused: true, data: {id: id(90)}});
    expect(create).toHaveBeenCalledOnce();
    create.mockRestore();
  });
  it('does not convert a conflicting property type into a date', async () => {
    sqlite.prepare('UPDATE page_columns SET data=? WHERE id=?').run(JSON.stringify({publicKey: {key: 'agendado_para', aliases: []}}), textId);
    expect(await new PageColumnController().ensureCalendarDate(parent, owner)).toMatchObject({ok: false, reason: 'conflict'});
    expect(sqlite.prepare('SELECT type FROM page_columns WHERE id=?').get(textId)?.type).toBe('text');
  });
  it('never replaces a tracked property with another date and preserves the parent view snapshot', async () => {
    const viewId = id(75), snapshot = {[viewId]: {view: 'calendar', dateColumnId: dateId, orderedHeaderCols: [textId, dateId]}, preferences: {keep: true}};
    sqlite.prepare('UPDATE pages SET data=? WHERE id=?').run(JSON.stringify(snapshot), parent);
    sqlite.prepare('UPDATE page_columns SET data=? WHERE id=?').run(JSON.stringify({publicKey: {key: 'agendado_para', aliases: []}}),dateId);
    const controller = new PageColumnController();
    expect(await controller.ensureCalendarDate(parent, owner)).toMatchObject({ok: true, data: {id: dateId}});
    expect(JSON.parse(String(sqlite.prepare('SELECT data FROM pages WHERE id=?').get(parent)?.data))).toEqual({...snapshot, schedule: {dateColumnId: dateId}});
    sqlite.prepare("UPDATE page_columns SET type='text' WHERE id=?").run(dateId);
    expect(await controller.ensureCalendarDate(parent, owner)).toMatchObject({ok: false, reason: 'conflict'});
    expect(sqlite.prepare("SELECT json_extract(data,'$.schedule.dateColumnId') AS id FROM pages WHERE id=?").get(parent)?.id).toBe(dateId);
  });
});
