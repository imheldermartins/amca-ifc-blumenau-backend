import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { loadChain } from '@cubs/rqlite-client/migrations';
import { describe, expect, it, vi } from 'vitest';
const query = vi.hoisted(() => vi.fn());
const findCells = vi.hoisted(() => vi.fn());
vi.mock('@models/index', () => ({ default: { sqlRaw: query, pageColumnValues: { findAll: findCells } } }));
import { PageExportStore } from './page-export-repository.js';
import type { Schema } from '@/db/schemas/index';
import { PagePdfService } from '@/services/pages/page-pdf-service';
import { pdfColumn, recursiveToken } from '@/services/pages/recursive-template';
import type { MentionStore } from '@/repositories/mention-repository';

const ids = {"owner":"01M00000000000000000000001","reader":"01M00000000000000000000002","outsider":"01M00000000000000000000003","parent":"01M00000000000000000000004","visible":"01M00000000000000000000005","hidden":"01M00000000000000000000006","deleted":"01M00000000000000000000007","grandchild":"01M00000000000000000000008","allowed":"01M00000000000000000000009","reader-parent":"01M00000000000000000000010","blocked":"01M00000000000000000000011","reader-hidden":"01M00000000000000000000012"} as const;

describe('page PDF dataset authorization in SQLite', () => {
  it('inherits rollup formats from the source in PDF mentions, recursive rows and batch templates', async () => {
    const database = new DatabaseSync(':memory:');
    const id = (number: number) => `01M${String(number).padStart(23, '0')}`;
    const actor = id(100), root = id(101), lots = id(102), titles = id(103), lot = id(104), empty = id(105), first = id(106), second = id(107);
    const relation = id(108), amount = id(109), total = id(110), count = id(111), minimum = id(112);
    try {
      const chain = await loadChain(fileURLToPath(new URL('../db/migrations', import.meta.url)));
      for (const migration of chain.migrations) for (const statement of migration.up) { if (typeof statement !== 'string') throw new Error('Expected DDL'); database.exec(statement); }
      query.mockImplementation(async (statement: SqlStatement) => database.prepare(statement.text).all(...statement.values as SQLInputValue[]));
      findCells.mockImplementation(async (lookup: { page_id: string }) => database.prepare('SELECT * FROM page_columns_values WHERE page_id=?').all(lookup.page_id));
      database.prepare('INSERT INTO users(id,email) VALUES(?,?)').run(actor, 'pdf@example.test');
      for (const page of [root, lots, titles, lot, empty, first, second]) database.prepare('INSERT INTO pages(id,owner_id,title) VALUES(?,?,?)').run(page, actor, page === lots ? 'Lotes' : page === lot ? 'Lote 1' : page === empty ? 'Lote 2' : 'Página');
      for (const [parent, child] of [[root, lots], [root, titles], [lots, lot], [lots, empty], [titles, first], [titles, second]]) database.prepare('INSERT INTO page_edges(id,parent_id,child_id) VALUES(?,?,?)').run(child!, parent!, child!);
      database.prepare('INSERT INTO workspaces(id,name,created_by_user_id) VALUES(?,?,?)').run(id(113), 'PDF', actor);
      database.prepare('INSERT INTO workspace_members(id,workspace_id,user_id,page_root_id) VALUES(?,?,?,?)').run(id(114), id(113), actor, root);
      const addColumn = (columnId: string, parent: string, type: string, data: unknown) => database.prepare('INSERT INTO page_columns(id,parent_id,name,type,data) VALUES(?,?,?,?,?)').run(columnId, parent, columnId, type, JSON.stringify(data));
      addColumn(relation, lots, 'relation', { relation: { version: 1, targetDatabaseId: titles, cardinality: 'many' } });
      addColumn(amount, titles, 'numeric', { format: 'currency', currency: 'BRL' });
      addColumn(total, lots, 'extract_as', { rollup: { version: 1, relationColumnId: relation, operation: 'sum', targetColumnId: amount } });
      addColumn(minimum, lots, 'extract_as', { rollup: { version: 1, relationColumnId: relation, operation: 'min', targetColumnId: amount } });
      // Legacy display settings on the rollup must not turn COUNT into money.
      addColumn(count, lots, 'extract_as', { format: 'currency', rollup: { version: 1, relationColumnId: relation, operation: 'count' } });
      database.prepare('INSERT INTO page_columns_values(id,page_id,page_column_id,data) VALUES(?,?,?,?)').run(id(115), lot, relation, JSON.stringify({ value: [first, second] }));
      for (const [index, page, value] of [[116, first, 10000], [117, second, 1540000]] as const) {
        database.prepare('INSERT INTO page_columns_values(id,page_id,page_column_id,data) VALUES(?,?,?,?)').run(id(index), page, amount, JSON.stringify({ value }));
      }
      const store = new PageExportStore();
      vi.spyOn(store, 'columns').mockImplementation(async (parentId) => database.prepare('SELECT * FROM page_columns WHERE parent_id=?').all(parentId).map((column) => ({ ...column, data: JSON.parse(String(column.data)) })) as unknown as Schema.PageColumn[]);
      const columns = await store.columns(lots);
      const context = await store.row({ id: lot, title: 'Lote 1' }, columns, actor);
      const missing = await store.row({ id: empty, title: 'Lote 2' }, columns, actor);
      await store.calculated([context, missing], columns, lots, actor);
      const brl = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
      expect(context.values).toMatchObject({ [total]: brl(15500), [minimum]: brl(100), [count]: '2' });
      expect(missing.values).toMatchObject({ [total]: brl(0), [minimum]: '', [count]: '0' });

      const table = { columns: 1, rows: [{ id: 'repeat', mode: 'repeat', cells: [{ id: 'value', column: 0, colSpan: 1, rowSpan: 1, header: false, text: recursiveToken(`recursive:relation:${relation}:columns.${total}`) }] }] };
      vi.spyOn(store, 'document').mockResolvedValue({ content: { type: 'doc', content: [
        { type: 'paragraph', content: [{ type: 'text', text: `Total: ${recursiveToken(pdfColumn(total))}` }] },
        { type: 'editableBlock', attrs: { kind: 'tableRecursive', recursive: { version: 1, relationColumnId: relation, fields: [], table } }, content: [{ type: 'paragraph' }] },
      ] } } as never);
      // Both the fixed page mention and repeated related-row values use the
      // same formatted projection, without adding a manual R$ prefix.
      vi.spyOn(store, 'relationRows').mockResolvedValue([context]);
      const render = vi.fn(async (_html: string) => Buffer.from('%PDF-1.4'));
      const service = new PagePdfService(store, { resolve: async () => ({}) } as unknown as MentionStore, render);
      await service.batch(lots, actor, [lot, empty]);
      expect(render.mock.calls[0]![0]).toContain(`Total: ${brl(15500)}`);
      expect(render.mock.calls[1]![0]).toContain(`Total: ${brl(0)}`);
      expect(render.mock.calls[0]![0]).toContain(`>${brl(15500)}</td>`);

      // Inheritance must be refreshed if the source format changes.
      database.prepare('UPDATE page_columns SET data=? WHERE id=?').run(JSON.stringify({ format: 'percentage' }), amount);
      database.prepare('UPDATE page_columns_values SET data=? WHERE id=?').run(JSON.stringify({ value: 12 }), id(116));
      database.prepare('UPDATE page_columns_values SET data=? WHERE id=?').run(JSON.stringify({ value: 13 }), id(117));
      await store.calculated([context], columns, lots, actor);
      expect(context.values).toMatchObject({ [total]: '25%', [minimum]: '12%', [count]: '2' });
      database.prepare('UPDATE page_columns SET data=? WHERE id=?').run('{}', amount);
      await store.calculated([context], columns, lots, actor);
      expect(context.values[total]).toBe('25');
    } finally { database.close(); }
  });
  it('authorizes each direct child, omits deleted pages, and never lists grandchildren', async () => {
    const database = new DatabaseSync(':memory:');
    try {
      const chain = await loadChain(fileURLToPath(new URL('../db/migrations', import.meta.url)));
      for (const migration of chain.migrations) for (const statement of migration.up) { if (typeof statement !== 'string') throw new Error('Expected DDL'); database.exec(statement); }
      query.mockImplementation(async (statement: SqlStatement) => database.prepare(statement.text).all(...statement.values as SQLInputValue[]));
      for (const id of [ids["owner"], ids["reader"], ids["outsider"]]) database.prepare('INSERT INTO users(id,email) VALUES(?,?)').run(id, `${id}@example.test`);
      for (const id of [ids["parent"], ids["visible"], ids["hidden"], ids["deleted"], ids["grandchild"]]) database.prepare('INSERT INTO pages(id,title,owner_id) VALUES(?,?,?)').run(id, id, ids["owner"]);
      for (const id of [ids["visible"], ids["hidden"], ids["deleted"]]) database.prepare('INSERT INTO page_edges(id,parent_id,child_id) VALUES(?,?,?)').run(id, ids["parent"], id);
      database.prepare('INSERT INTO page_edges(id,parent_id,child_id) VALUES(?,?,?)').run(ids["grandchild"], ids["visible"], ids["grandchild"]);
      database.prepare('UPDATE pages SET deleted_at=CURRENT_TIMESTAMP WHERE id=?').run(ids["deleted"]);
      database.prepare('INSERT INTO page_roles(id,page_id,name,roles) VALUES(?,?,?,?)').run(ids["allowed"], ids["parent"], 'Reader', JSON.stringify({ read: ['view', 'subpages'], write: [] }));
      database.prepare('INSERT INTO page_collaborators(id,page_id,user_id,page_member_role_id) VALUES(?,?,?,?)').run(ids["reader-parent"], ids["parent"], ids["reader"], ids["allowed"]);
      database.prepare('INSERT INTO page_roles(id,page_id,name,roles) VALUES(?,?,?,?)').run(ids["blocked"], ids["hidden"], 'Blocked', JSON.stringify({ read: [], write: [] }));
      database.prepare('INSERT INTO page_collaborators(id,page_id,user_id,page_member_role_id) VALUES(?,?,?,?)').run(ids["reader-hidden"], ids["hidden"], ids["reader"], ids["blocked"]);
      const store = new PageExportStore();
      expect((await store.children(ids["parent"], ids["reader"])).map((page) => page.id)).toEqual([ids["visible"]]);
      expect(await store.page(ids["hidden"], ids["reader"])).toBeNull();
      expect(await store.page(ids["parent"], ids["outsider"])).toBeNull();
      expect(await store.children(ids["parent"], ids["outsider"])).toEqual([]);
      // A self Relation still projects only its selected 1/N values, never every child.
      const relation = { id: 'relation', type: 'relation', data: { relation: { version: 1, targetDatabaseId: ids.parent, cardinality: 'many' } } } as unknown as Schema.PageColumn;
      vi.spyOn(store, 'columns').mockResolvedValue([relation]);
      vi.spyOn(store, 'row').mockImplementation(async (page) => ({ id: page.id, title: page.title ?? '', values: {}, dates: {} }));
      const selected = [ids.hidden, ids.visible, ids.deleted, ids.grandchild];
      findCells.mockResolvedValue([{ data: JSON.stringify({ value: selected }) }]);
      expect((await store.relationRows(ids.visible, 'relation', ids.owner))?.map((row) => row.id)).toEqual([ids.hidden, ids.visible]);
      expect((await store.relationRows(ids.visible, 'relation', ids.reader))?.map((row) => row.id)).toEqual([ids.visible]);
      expect(await store.relationRows(ids.visible, 'relation', ids.outsider)).toBeNull();
      expect(await store.relationRows(ids.visible, 'not-a-relation', ids.owner)).toBeNull();
      findCells.mockResolvedValue([{ data: JSON.stringify({ value: [ids.visible] }) }]);
      expect(await store.relationRows(ids.visible, 'relation', ids.owner)).toHaveLength(1);
      findCells.mockResolvedValue([]);
      expect(await store.relationRows(ids.visible, 'relation', ids.owner)).toEqual([]);
    } finally { database.close(); }
  });
});
