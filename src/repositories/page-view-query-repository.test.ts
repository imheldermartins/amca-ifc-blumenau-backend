import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { PageViewQueryStore, QUERY_FALLBACK_VIEW } from './page-view-query-repository.js';
import { PageViewQueryCursor, PageViewQueryError } from './page-view-query-cursor.js';
import { compileQueryFilters, normalizeQueryText } from './page-view-query-filters.js';
import { pageViewScopeKey, type PageViewQueryRequest } from '@/services/pages/views/page-view-query-contract';
import {PageRelationRepository} from './page-relation-repository.js';
import formulas, { PageFormulaRepository } from './page-formula-repository.js';
import type {Schema} from '@/db/schemas/index';
import {migration as relationLinks} from '@/db/migrations/20261020022641135_27e708b6_relation_links_and_cardinality';
import {migration as relationSnapshots} from '@/db/migrations/20261020023101397_c32e8cfa_relation_snapshot_invariants';

const id = (value: number) => `01M${String(value).padStart(23, '0')}`;
const ROOT = id(90001), OWNER = id(90002), VIEWER = id(90003), VIEW = id(90004), SELECT = id(90005), A = id(90006), B = id(90007), NUMERIC = id(90008), DATE = id(90009), CHECKBOX = id(90010), TEXT = id(90011);

function fixture(count = 100) {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys=ON');
  database.exec(`CREATE TABLE users(id TEXT PRIMARY KEY);
    CREATE TABLE pages(id TEXT PRIMARY KEY,title TEXT,owner_id TEXT,data TEXT,created_at TEXT,updated_at TEXT,deleted_at TEXT);
    CREATE TABLE page_edges(id TEXT PRIMARY KEY,parent_id TEXT,child_id TEXT);
    CREATE TABLE page_collaborators(page_id TEXT,user_id TEXT,page_member_role_id TEXT,deleted_at TEXT);
    CREATE TABLE page_roles(id TEXT,page_id TEXT,roles TEXT,deleted_at TEXT);
    CREATE TABLE workspaces(id TEXT,created_by_user_id TEXT,organization_id TEXT);
    CREATE TABLE workspace_members(workspace_id TEXT,user_id TEXT,workspace_member_role_id TEXT,page_root_id TEXT,deleted_at TEXT);
    CREATE TABLE workspace_roles(id TEXT,workspace_id TEXT,roles TEXT,deleted_at TEXT);
    CREATE TABLE organizations(id TEXT,owner_id TEXT);
    CREATE TABLE organization_members(organization_id TEXT,user_id TEXT,organization_member_role_id TEXT,deleted_at TEXT);
    CREATE TABLE organization_roles(id TEXT,organization_id TEXT,roles TEXT,deleted_at TEXT);
    CREATE TABLE page_columns(id TEXT PRIMARY KEY,name TEXT,type TEXT,data TEXT,parent_id TEXT,deleted_at TEXT);
    CREATE TABLE page_columns_values(id TEXT PRIMARY KEY,page_id TEXT,page_column_id TEXT,data TEXT);
    CREATE TABLE page_view_row_order(edge_id TEXT,view_id TEXT,rank TEXT,PRIMARY KEY(edge_id,view_id));`);
  database.exec([...relationLinks.up, ...relationSnapshots.up].join(';'));
  database.prepare('INSERT INTO users(id) VALUES (?),(?)').run(OWNER, VIEWER);
  const view: Record<string, unknown> = { view: 'table', name: 'Tabela', filters: { version: 2, clauses: [], groupBy: [], passthrough: [] }, orderedRows: Array.from({ length: count }, (_, index) => id(index + 1)), rowOrder: { version: 2, revision: 7 } };
  database.prepare('INSERT INTO pages(id,title,owner_id,data,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(ROOT, 'Base', OWNER, JSON.stringify({ [VIEW]: view }), '2026-10-01', '2026-10-01');
  const addPage = database.prepare('INSERT INTO pages(id,title,owner_id,data,created_at,updated_at) VALUES (?,?,?,?,?,?)'), edge = database.prepare('INSERT INTO page_edges(id,parent_id,child_id) VALUES (?,?,?)'), rank = database.prepare('INSERT INTO page_view_row_order(edge_id,view_id,rank) VALUES (?,?,?)');
  for (let index = 1; index <= count; index++) {
    const rowId = id(index), title = `Página ${index}`;
    addPage.run(rowId, title, OWNER, '{}', '2026-10-01', '2026-10-01'); edge.run(rowId, ROOT, rowId); rank.run(rowId, VIEW, rowId);
  }
  const addColumn = database.prepare('INSERT INTO page_columns(id,name,type,data,parent_id) VALUES (?,?,?,?,?)');
  addColumn.run(SELECT, 'Estado', 'select', JSON.stringify({ options: [{ id: A, value: 'Primeiro', color: 'pink' }, { id: B, value: 'Segundo', color: 'orange' }] }), ROOT);
  for (const [columnId, type] of [[NUMERIC, 'numeric'], [DATE, 'date'], [CHECKBOX, 'checkbox'], [TEXT, 'text']]) addColumn.run(columnId!, type!, type!, '{}', ROOT);
  const sqlReads: { text: string; returned: number }[] = [];
  const execute = async <T>(statement: { text: string; values: unknown[] }) => {
    const result = database.prepare(statement.text).all(...statement.values as SQLInputValue[]) as T[];
    sqlReads.push({ text: statement.text, returned: result.length }); return result;
  };
  const store = new PageViewQueryStore(execute, undefined, new PageViewQueryCursor('test-secret'));
  const setView = (patch: Record<string, unknown>) => { Object.assign(view, patch); database.prepare('UPDATE pages SET data=? WHERE id=?').run(JSON.stringify({ [VIEW]: view }), ROOT); };
  const cell = (row: number, columnId: string, value: unknown) => {
    database.prepare('INSERT OR REPLACE INTO page_columns_values(id,page_id,page_column_id,data) VALUES (?,?,?,?)')
      .run(`${id(row)}-${columnId}`, id(row), columnId, JSON.stringify({ value }));
  };
  const query = (request: PageViewQueryRequest = {}, actor = OWNER, viewId = VIEW) => store.query(ROOT, viewId, actor, request);
  return { database, store, execute, cell, query, setView, sqlReads, close: () => database.close() };
}

describe('SQL view projections', () => {
  it('calculates a newly created Lote outside filters/windows using the real canonical index, without storing a formula cell', async () => {
    const f = fixture(100), formulaId = id(91000), newId = id(101);
    const engine = new PageFormulaRepository(<T>(statement: string | SqlStatement) => f.execute<T>(typeof statement === 'string' ? { text: statement, values: [] } : statement));
    const evaluate = vi.spyOn(formulas, 'evaluateColumns').mockImplementation(engine.evaluateColumns.bind(engine));
    try {
      f.database.prepare('INSERT INTO page_columns(id,name,type,parent_id,data) VALUES (?,?,?,?,?)').run(formulaId, 'Lote', 'formula', ROOT, JSON.stringify({ formula: { version: 1, revision: 1, source: '"#" + padStart(toText(index()), 4, "0")' } }));
      expect((await f.query({ limit: 1 })).windows[0]?.rows[0]?.page_columns[formulaId]?.row_data).toBe(JSON.stringify({ value: '#0001' }));
      f.database.prepare('INSERT INTO pages(id,title,owner_id,data) VALUES (?,?,?,?)').run(newId, 'Novo lote', OWNER, '{}');
      f.database.prepare('INSERT INTO page_edges(id,parent_id,child_id) VALUES (?,?,?)').run(newId, ROOT, newId);
      f.database.prepare('INSERT INTO page_view_row_order(edge_id,view_id,rank) VALUES (?,?,?)').run(newId, VIEW, newId);
      const filtered = { version: 2 as const, clauses: [{ columnId: 'page_title', condition: 'contains' as const, values: ['Página'] }], groupBy: [] };
      const result = await f.query({ filters: filtered, includeRowIds: [newId], limit: 1 });
      expect(result.total).toBe(100);
      expect(result.windows[0]?.rows).toHaveLength(1);
      expect(result.includedRows).toHaveLength(1);
      expect(result.includedRows?.[0]?.page_columns[formulaId]?.row_data).toBe(JSON.stringify({ value: '#0101' }));
      f.database.prepare('UPDATE pages SET deleted_at=? WHERE id=?').run('2026-10-25', id(1));
      const refreshed = await f.query({ filters: filtered, includeRowIds: [newId], metadataOnly: true });
      expect(refreshed.windows).toEqual([]);
      expect(refreshed.includedRows?.[0]?.page_columns[formulaId]?.row_data).toBe(JSON.stringify({ value: '#0100' }));
      expect(f.database.prepare('SELECT COUNT(*) AS count FROM page_columns_values WHERE page_column_id=?').get(formulaId)).toEqual({ count: 0 });
    } finally { evaluate.mockRestore(); f.close(); }
  });

  it('does not hydrate pages from another database or deleted pages', async () => {
    const f = fixture(3);
    try {
      f.database.prepare('UPDATE page_edges SET parent_id=? WHERE child_id=?').run(id(95000), id(2));
      f.database.prepare('UPDATE pages SET deleted_at=? WHERE id=?').run('2026-10-25', id(3));
      const result = await f.query({ metadataOnly: true, includeRowIds: [id(1), id(2), id(3), id(99999)] });
      expect(result.includedRows?.map((row) => row.page_id)).toEqual([id(1)]);
    } finally { f.close(); }
  });
  it('applies child read permissions to included rows even outside the view filters', async () => {
    const f = fixture(3);
    try {
      f.database.prepare('INSERT INTO page_roles(id,page_id,roles) VALUES (?,?,?),(?,?,?)').run('reader', ROOT, JSON.stringify({ read: ['view', 'subpages'], write: [] }), 'hidden', id(1), JSON.stringify({ read: [], write: [] }));
      f.database.prepare('INSERT INTO page_collaborators(page_id,user_id,page_member_role_id) VALUES (?,?,?),(?,?,?)').run(ROOT, VIEWER, 'reader', id(1), VIEWER, 'hidden');
      const result = await f.query({ metadataOnly: true, includeRowIds: [id(1), id(2)] }, VIEWER);
      expect(result.includedRows?.map((row) => row.page_id)).toEqual([id(2)]);
    } finally { f.close(); }
  });
  it('confere o kind enviado pela sessão contra a view persistida', async () => {
    const f = fixture(1);
    try {
      await expect(f.query({ view: 'table' })).resolves.toMatchObject({ kind: 'table' });
      await expect(f.query({ view: 'board' })).rejects.toMatchObject({
        status: 409,
        code: 'VIEW_CHANGED',
      });
    } finally { f.close(); }
  });

  it('bounds a 10,000-row collection before loading cells and keeps metadata small', async () => {
    const f = fixture(10_000);
    try {
      const metadata = await f.store.metadata(ROOT, OWNER);
      expect(metadata.page.data[VIEW]).not.toHaveProperty('orderedRows');
      expect(JSON.stringify(metadata).length).toBeLessThan(3000);
      const first = await f.query({}, OWNER, QUERY_FALLBACK_VIEW);
      expect(first.total).toBe(10_000); expect(first.windows[0]?.rows).toHaveLength(50);
      const second = await f.query({ cursor: first.windows[0]!.nextCursor }, OWNER, QUERY_FALLBACK_VIEW);
      expect(second.windows[0]?.rows[0]?.page_id).toBe(id(51));
      expect(new Set([...first.windows[0]!.rows, ...second.windows[0]!.rows].map((row) => row.page_id)).size).toBe(100);
      expect(f.sqlReads.every((read) => read.returned <= 51)).toBe(true);
      expect(f.sqlReads.some((read) => read.text.startsWith('SELECT id,rank_key') && read.text.includes('LIMIT ?') && read.returned === 51)).toBe(true);
      expect(f.sqlReads.filter((read) => read.text.includes('GROUP BY selected.window_key')).map((read) => read.returned)).toEqual([50, 50]);
    } finally { f.close(); }
  });
  it('distributes one shared budget over Board options and includes an empty neutral Board', async () => {
    const f = fixture(200);
    try {
      f.setView({ view: 'board', board: { selectColumnId: SELECT } });
      for (let row = 1; row <= 200; row++) f.cell(row, SELECT, row % 2 ? A : B);
      const result = await f.query();
      expect(result.groups?.map((group) => [group.label, group.total])).toEqual([['Primeiro', 100], ['Segundo', 100], ['Sem valor', 0]]);
      expect(result.windows.filter((window) => window.total > 0).map((window) => window.rows.length)).toEqual([25, 25]);
      expect(result.windows.reduce((sum, window) => sum + window.rows.length, 0)).toBe(50);
      const next = await f.query({ scope: { type: 'board', optionId: A }, cursor: result.windows[0]!.nextCursor });
      expect(next.groups?.map((group) => group.total)).toEqual([100, 100, 0]);
      expect(next.windows[0]?.rows).toHaveLength(50); expect(next.windows[0]?.total).toBe(100);
      expect(next.windows[0]?.rows[0]?.page_id).toBe(id(51));
    } finally { f.close(); }
  });
  it('does not materialize collapsed/offscreen groups, while totals stay complete', async () => {
    const f = fixture();
    try {
      f.setView({ view: 'board', board: { selectColumnId: SELECT, collapsedOptionIds: [A] } });
      for (let row = 1; row <= 100; row++) f.cell(row, SELECT, row % 2 ? A : B);
      const result = await f.query({ visibleGroupKeys: [`board:${B}`] });
      expect(result.windows.filter((window) => window.rows.length)).toHaveLength(1); expect(result.windows[0]?.rows).toHaveLength(50);
      expect(result.groups?.[0]?.total).toBe(50);
      const collapsed = result.windows.find((window) => window.key === `board:${A}`)!;
      expect(collapsed.rows).toEqual([]); expect(collapsed.nextCursor).toBeTruthy();
      const loaded = await f.query({ scope: { type: 'board', optionId: A }, cursor: collapsed.nextCursor });
      expect(loaded.windows[0]?.rows[0]?.page_id).toBe(id(1)); expect(loaded.windows[0]?.rows).toHaveLength(50);
    } finally { f.close(); }
  });
  it('maps deleted/unknown options and missing values to Sem valor using ULIDs', async () => {
    const f = fixture(4);
    try {
      f.setView({ view: 'board', board: { selectColumnId: SELECT } });
      f.cell(1, SELECT, A); f.cell(2, SELECT, 'Nome da opção'); f.cell(3, SELECT, id(98765));
      const result = await f.query();
      expect(result.groups?.map((group) => group.total)).toEqual([1, 0, 3]);
      expect(result.windows.find((window) => window.scope.type === 'board' && window.scope.optionId === '__unassigned__')?.rows.map((row) => row.page_id)).toEqual([id(2), id(3), id(4)]);
    } finally { f.close(); }
  });
  it('filters normalized accents and applies numeric predicates before LIMIT', async () => {
    const f = fixture();
    try {
      for (let row = 1; row <= 100; row++) f.cell(row, NUMERIC, row);
      const result = await f.query({ filters: { version: 2, groupBy: [], clauses: [{ columnId: 'page_title', condition: 'contains', values: ['PÁGINA'] }, { columnId: NUMERIC, condition: 'greaterThan', values: ['95'] }] } });
      expect(result.total).toBe(5); expect(result.windows[0]?.rows.map((row) => row.page_id)).toEqual([96, 97, 98, 99, 100].map(id));
    } finally { f.close(); }
  });
  it('preserves checkbox absent/null/false semantics and ignores invalid clauses', async () => {
    const f = fixture(6);
    try {
      f.cell(1, CHECKBOX, true); f.cell(2, CHECKBOX, false); f.cell(3, CHECKBOX, null); f.cell(4, CHECKBOX, 'false'); f.cell(5, CHECKBOX, 0);
      const result = await f.query({ filters: { version: 2, groupBy: [], clauses: [{ columnId: CHECKBOX, condition: 'equals', values: ['false'] }, { columnId: TEXT, condition: 'contains', values: [''] }, { columnId: DATE, condition: 'greaterThan', values: ['2026-10-02'] }] } });
      expect(result.windows[0]?.rows.map((row) => row.page_id)).toEqual([id(2), id(3), id(6)]);
    } finally { f.close(); }
  });
  it('counts only authorized rows, including direct ACL overrides, before allocating the first 50', async () => {
    const f = fixture();
    try {
      f.database.prepare('INSERT INTO page_roles(id,page_id,roles) VALUES (?,?,?),(?,?,?)').run('reader', ROOT, JSON.stringify({ read: ['view', 'subpages'], write: [] }), 'hidden', id(1), JSON.stringify({ read: [], write: [] }));
      f.database.prepare('INSERT INTO page_collaborators(page_id,user_id,page_member_role_id) VALUES (?,?,?),(?,?,?)').run(ROOT, VIEWER, 'reader', id(1), VIEWER, 'hidden');
      const result = await f.query({}, VIEWER);
      expect(result.total).toBe(99); expect(result.windows[0]?.rows).toHaveLength(50); expect(result.windows[0]?.rows[0]?.page_id).toBe(id(2));
      expect(f.sqlReads.filter((read) => read.text.includes('COUNT(*)')).every((read) => read.text.includes('shared_branch') && read.text.indexOf('shared_branch') < read.text.indexOf('COUNT(*)'))).toBe(true);
    } finally { f.close(); }
  });
  it('revalidates row ACL and filters during hydration after selecting the IDs', async () => {
    const f = fixture();
    try {
      f.database.prepare('INSERT INTO page_roles(id,page_id,roles) VALUES (?,?,?),(?,?,?)').run('reader', ROOT, JSON.stringify({ read: ['view', 'subpages'], write: [] }), 'hidden', id(1), JSON.stringify({ read: [], write: [] }));
      f.database.prepare('INSERT INTO page_collaborators(page_id,user_id,page_member_role_id) VALUES (?,?,?)').run(ROOT, VIEWER, 'reader');
      let revoked = false;
      const interleavedRead = async <T>(statement: { text: string; values: unknown[] }): Promise<T[]> => {
        const rows = await f.execute<T>(statement);
        if (!revoked && statement.text.startsWith('SELECT id,rank_key')) {
          revoked = true;
          f.database.prepare('INSERT INTO page_collaborators(page_id,user_id,page_member_role_id) VALUES (?,?,?)').run(id(1), VIEWER, 'hidden');
          f.database.prepare('UPDATE pages SET title=? WHERE id=?').run('Outro título', id(2));
        }
        return rows;
      };
      const result = await new PageViewQueryStore(interleavedRead, undefined, new PageViewQueryCursor('test-secret')).query(ROOT, VIEW, VIEWER,
        { filters: { version: 2, groupBy: [], clauses: [{ columnId: 'page_title', condition: 'contains', values: ['Página'] }] } });
      expect(result.windows[0]?.rows).toHaveLength(48);
      expect(result.windows[0]?.rows.some((row) => row.page_id === id(1) || row.page_id === id(2))).toBe(false);
    } finally { f.close(); }
  });
  it('rejects the projection when page access is revoked between ID selection and hydration', async () => {
    const f = fixture();
    try {
      f.database.prepare('INSERT INTO page_roles(id,page_id,roles) VALUES (?,?,?)').run('reader', ROOT, JSON.stringify({ read: ['view', 'subpages'], write: [] }));
      f.database.prepare('INSERT INTO page_collaborators(page_id,user_id,page_member_role_id) VALUES (?,?,?)').run(ROOT, VIEWER, 'reader');
      const interleavedRead = async <T>(statement: { text: string; values: unknown[] }): Promise<T[]> => {
        const rows = await f.execute<T>(statement);
        if (statement.text.startsWith('SELECT id,rank_key')) f.database.prepare('UPDATE page_roles SET roles=? WHERE id=?').run(JSON.stringify({ read: [], write: [] }), 'reader');
        return rows;
      };
      await expect(new PageViewQueryStore(interleavedRead, undefined, new PageViewQueryCursor('test-secret')).query(ROOT, VIEW, VIEWER, {})).rejects.toMatchObject({ status: 404 });
    } finally { f.close(); }
  });
  it('binds cursors to query, actor, scope and the persisted order revision', async () => {
    const f = fixture();
    try {
      const first = await f.query(), token = first.windows[0]!.nextCursor!;
      await expect(f.query({ cursor: `${token.slice(0, -4)}abcd` })).rejects.toMatchObject({ status: 400 });
      await expect(f.query({ cursor: token, filters: { version: 2, groupBy: [], clauses: [{ columnId: 'page_title', condition: 'contains', values: ['2'] }] } })).rejects.toMatchObject({ status: 400 });
      f.setView({ rowOrder: { version: 2, revision: 8 } });
      await expect(f.query({ cursor: token })).rejects.toMatchObject({ status: 409, code: 'STALE_CURSOR' });
    } finally { f.close(); }
  });
  it('reconciles a retained anchor and fetches backward without skipping its boundary', async () => {
    const f = fixture(200);
    try {
      const retained = await f.query({ anchorId: id(101) });
      expect(retained.windows[0]?.rows[0]?.page_id).toBe(id(101));
      const previous = await f.query({ cursor: retained.windows[0]!.previousCursor, direction: 'previous' });
      expect(previous.windows[0]?.rows.map((row) => row.page_id)).toEqual(Array.from({ length: 50 }, (_, index) => id(index + 51)));
    } finally { f.close(); }
  });
  it('returns a server group tree and pages headers independently from leaf rows', async () => {
    const f = fixture(120);
    try {
      f.setView({ filters: { version: 2, groupBy: [TEXT], clauses: [], passthrough: [] } });
      for (let row = 1; row <= 120; row++) f.cell(row, TEXT, `Grupo ${row}`);
      const first = await f.query();
      expect(first.groups).toHaveLength(50); expect(first.windows.reduce((sum, window) => sum + window.rows.length, 0)).toBe(50); expect(first.groupsNextCursor).toBeTruthy();
      const next = await f.query({ groupCursor: first.groupsNextCursor ?? null });
      expect(next.groups?.[0]?.label).toBe('Grupo 51'); expect(next.groups).toHaveLength(50);
    } finally { f.close(); }
  });
  it('keeps ancestor group totals complete when only 50 leaf headers are returned', async () => {
    const f = fixture(120);
    try {
      f.setView({ filters: { version: 2, groupBy: [SELECT, TEXT], clauses: [], passthrough: [] } });
      for (let row = 1; row <= 120; row++) { f.cell(row, SELECT, A); f.cell(row, TEXT, `Grupo ${row}`); }
      const result = await f.query();
      expect(result.groups?.[0]?.total).toBe(120); expect(result.groups?.[0]?.children).toHaveLength(50);
    } finally { f.close(); }
  });
  it('preserves numeric group display instead of exposing the SQL REAL serialization', async () => {
    const f = fixture(3);
    try {
      f.setView({ filters: { version: 2, groupBy: [NUMERIC], clauses: [], passthrough: [] } });
      f.cell(1, NUMERIC, 123); f.cell(2, NUMERIC, '123'); f.cell(3, NUMERIC, 123);
      const plain = await f.query();
      expect(plain.groups?.map((group) => [group.label, group.total])).toEqual([['123', 2], ['Sem valor', 1]]);
      f.database.prepare('UPDATE page_columns SET data=? WHERE id=?').run(JSON.stringify({ format: 'currency' }), NUMERIC);
      expect((await f.query()).groups?.[0]?.label).toBe(new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(1.23));
    } finally { f.close(); }
  });
  it('returns full calendar day counts with a bounded total preview and pages a selected day', async () => {
    const f = fixture(200);
    try {
      f.setView({ view: 'calendar', dateColumnId: DATE });
      for (let row = 1; row <= 200; row++) { const day = row % 2 ? '2026-10-05' : '2026-10-06', start = Date.parse(`${day}T00:00:00.000Z`); f.cell(row, DATE, new Date(start).toISOString()); }
      const result = await f.query();
      expect(result.days?.['2026-10-05']).toBe(100); expect(result.days?.['2026-10-06']).toBe(100);
      expect(result.windows).toHaveLength(1); expect(result.windows[0]?.rows).toHaveLength(50);
      expect(result.windows[0]?.key).toBe(pageViewScopeKey({ type: 'calendar', from: '2026-10-01', to: '2026-10-31' }));
      expect(result.windows[0]?.nextCursor).toBeNull(); expect(result.windows[0]?.previousCursor).toBeNull();
      const day = await f.query({ scope: { type: 'calendar', from: '2026-10-01', to: '2026-10-31', day: '2026-10-05' } });
      expect(day.windows[0]?.total).toBe(100); expect(day.windows[0]?.rows).toHaveLength(50);
    } finally { f.close(); }
  });
  it('computes heatmap completion intensity from checkboxes and ignores date ranges', async () => {
    const f = fixture(4);
    try {
      f.setView({ view: 'heatmap', heatmap: { version: 1, dateColumnId: DATE, checkboxColumnId: CHECKBOX, period: { mode: 'months', monthCount: 1 } } });
      f.cell(1, DATE, '2026-10-05T00:00:00.000Z'); f.cell(1, CHECKBOX, true);
      f.cell(2, DATE, '2026-10-05T00:00:00.000Z'); f.cell(2, CHECKBOX, false);
      f.cell(3, DATE, '2026-10-05T00:00:00.000Z');
      f.cell(4, DATE, '2026-10-05T00:00:00.000Z@2026-10-06T00:00:00.000Z');

      const scope = { type: 'heatmap', from: '2026-10-01', to: '2026-10-31' } as const;
      const result = await f.query({ scope });
      expect(result.heatmapDays?.['2026-10-05']).toEqual({ total: 3, checked: 1 });
      expect(result.heatmapDays?.['2026-10-06']).toEqual({ total: 0, checked: 0 });
      expect(result.ignoredRanges).toBe(1);
      expect(result.windows).toEqual([]);

      const selected = await f.query({ scope: { ...scope, day: '2026-10-05' } });
      expect(selected.windows[0]?.total).toBe(3);
      expect(selected.windows[0]?.rows).toHaveLength(3);
      expect(selected.heatmapDays?.['2026-10-05']).toEqual({ total: 3, checked: 1 });
    } finally { f.close(); }
  });
  it('sums selected checkboxes without duplicating pages and paginates days with the same ACL and filters', async () => {
    const f = fixture(65);
    const extra = id(90012);
    try {
      f.database.prepare('INSERT INTO page_columns(id,name,type,data,parent_id) VALUES (?,?,?,?,?)').run(extra, 'Outra', 'checkbox', '{}', ROOT);
      f.setView({ view: 'heatmap', heatmap: { version: 2, dateColumnId: DATE, checkboxColumnIds: [CHECKBOX, extra], period: { mode: 'months', monthCount: 1 } } });
      for (let row = 1; row <= 65; row++) {
        f.cell(row, DATE, '2026-10-05T00:00:00.000Z');
        f.cell(row, CHECKBOX, true);
        if (row <= 13) f.cell(row, extra, true);
        else if (row <= 20) f.cell(row, extra, false);
      }
      f.database.prepare('INSERT INTO page_roles(id,page_id,roles) VALUES (?,?,?)').run('heatmap-reader', ROOT, JSON.stringify({ read: ['view', 'subpages'], write: [] }));
      f.database.prepare('INSERT INTO page_collaborators(page_id,user_id,page_member_role_id) VALUES (?,?,?)').run(ROOT, VIEWER, 'heatmap-reader');
      // A direct restriction interrupts the viewer's inherited read grant.
      f.database.prepare('INSERT INTO page_collaborators(page_id,user_id,page_member_role_id) VALUES (?,?,?)').run(id(65), VIEWER, 'hidden');
      const scope = { type: 'heatmap', from: '2026-10-01', to: '2026-10-31' } as const;
      const aggregate = await f.query({ scope }, VIEWER);
      expect(aggregate.checkboxColumnIds).toEqual([CHECKBOX, extra]);
      expect(aggregate.heatmapDays?.['2026-10-05']).toEqual({ total: 64, checked: 77 });
      const dayScope = { ...scope, day: '2026-10-05' };
      const first = await f.query({ scope: dayScope }, VIEWER);
      const second = await f.query({ scope: dayScope, cursor: first.windows[0]!.nextCursor }, VIEWER);
      expect(first.windows[0]?.total).toBe(64);
      expect(first.windows[0]?.rows).toHaveLength(50);
      expect(second.windows[0]?.rows).toHaveLength(14);
      expect(new Set([...first.windows[0]!.rows, ...second.windows[0]!.rows].map((row) => row.page_id)).size).toBe(64);
      const filtered = { version: 2 as const, clauses: [{ columnId: extra, condition: 'equals' as const, values: ['true'] }], groupBy: [], passthrough: [] };
      const subset = await f.query({ scope: dayScope, filters: filtered }, VIEWER);
      expect(subset.heatmapDays?.['2026-10-05']).toEqual({ total: 13, checked: 26 });
      expect(subset.windows[0]?.rows).toHaveLength(13);
      f.setView({ heatmap: { version: 2, dateColumnId: DATE, checkboxColumnIds: [CHECKBOX, TEXT], period: { mode: 'year' } } });
      await expect(f.query({ scope })).rejects.toMatchObject({ status: 400 });
    } finally { f.close(); }
  });
  it('uses inclusive range overlap for dates, including reverse operand order', async () => {
    const f = fixture(3);
    try {
      f.cell(1, DATE, '2026-10-06T23:59:59.999Z@2026-10-03T00:00:00.000Z');
      const result = await f.query({ filters: { version: 2, groupBy: [], clauses: [{ columnId: DATE, condition: 'between', values: ['2026-10-05', '2026-10-04'] }] } });
      expect(result.total).toBe(1); expect(result.windows[0]?.rows[0]?.page_id).toBe(id(1));
    } finally { f.close(); }
  });
  it('reads only a requested Graph branch and rejects roots from another tree', async () => {
    const f = fixture(3);
    try {
      f.setView({ view: 'graph', filters: { version: 2, groupBy: [], clauses: [{ columnId: 'page_title', condition: 'contains', values: ['Página'] }], passthrough: [] } });
      f.database.prepare('INSERT INTO pages(id,title,owner_id,data,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(id(4), 'Neta', OWNER, '{}', '2026-10-01', '2026-10-01');
      f.database.prepare('INSERT INTO page_edges(parent_id,child_id) VALUES (?,?)').run(id(1), id(4));
      const result = await f.query({ scope: { type: 'graph', parentId: id(1) } });
      expect(result.windows[0]?.rows.map((row) => row.page_id)).toEqual([id(4)]);
      await expect(f.query({ scope: { type: 'graph', parentId: id(98765) } })).rejects.toBeInstanceOf(PageViewQueryError);
    } finally { f.close(); }
  });
  it('does not read any rows for Form and invalid configured selectors do not silently switch', async () => {
    const f = fixture();
    try {
      f.setView({ view: 'form' }); expect((await f.query()).windows).toEqual([]);
      f.setView({ view: 'board', board: { selectColumnId: id(99999) } });
      const result = await f.query(); expect(result.windows).toEqual([]); expect(result.selectColumnId).toBeUndefined();
    } finally { f.close(); }
  });
  it('rejects a legacy/incomplete order without importing or writing from the query endpoint', async () => {
    const f = fixture();
    try {
      f.setView({ rowOrder: undefined });
      await expect(f.query()).rejects.toMatchObject({ status: 409, code: 'PAGINATION_NOT_READY' });
      f.setView({ rowOrder: { version: 2, revision: 7 } });
      f.database.prepare('DELETE FROM page_view_row_order WHERE edge_id=?').run(id(1));
      await expect(f.query()).rejects.toMatchObject({ status: 409, code: 'PAGINATION_NOT_READY' });
      expect(f.sqlReads.every((read) => !/^\s*(?:INSERT|UPDATE|DELETE)\b/i.test(read.text))).toBe(true);
    } finally { f.close(); }
  });
  it('applies persisted select filters when no temporary filter document is sent', async () => {
    const f = fixture(4);
    try {
      f.cell(1, SELECT, A); f.cell(2, SELECT, B); f.cell(3, SELECT, A);
      f.setView({ filters: { version: 2, groupBy: [], clauses: [{ columnId: SELECT, condition: 'equals', values: [A] }], passthrough: [] } });
      expect((await f.query()).windows[0]?.rows.map((row) => row.page_id)).toEqual([id(1), id(3)]);
    } finally { f.close(); }
  });
  it('balances the preview budget for a requested calendar period as well as the initial period', async () => {
    const f = fixture(200);
    try {
      f.setView({ view: 'calendar', dateColumnId: DATE });
      for (let row = 1; row <= 200; row++) { const start = Date.parse(`2026-10-${row % 2 ? '05' : '06'}T00:00:00.000Z`); f.cell(row, DATE, new Date(start).toISOString()); }
      const result = await f.query({ scope: { type: 'calendar', from: '2026-10-01', to: '2026-10-31' } });
      expect(result.windows.map((window) => window.rows.length)).toEqual([50]);
      expect(result.windows[0]?.rows.filter((row) => Number(row.page_id.slice(3)) % 2).length).toBe(25);
      expect(result.days?.['2026-10-05']).toBe(100);
    } finally { f.close(); }
  });
  it('budgets overlapping date ranges once, using their first overlapping day in a single period window', async () => {
    const f = fixture(200);
    try {
      f.setView({ view: 'calendar', dateColumnId: DATE });
      for (let row = 1; row <= 200; row++) {
        const start = Date.parse(`2026-10-${row % 2 ? '05' : '06'}T12:00:00.000Z`), end = start + 2 * 86_400_000;
        f.cell(row, DATE, `${new Date(start).toISOString()}@${new Date(end).toISOString()}`);
      }
      const scope = { type: 'calendar' as const, from: '2026-10-01', to: '2026-10-31' }, result = await f.query({ scope });
      expect(result.windows).toHaveLength(1); expect(result.windows[0]?.key).toBe(pageViewScopeKey(scope));
      const rows = result.windows[0]!.rows;
      expect(rows).toHaveLength(50); expect(new Set(rows.map((row) => row.page_id)).size).toBe(50);
      expect(rows.filter((row) => Number(row.page_id.slice(3)) % 2)).toHaveLength(25);
      expect(result.days?.['2026-10-06']).toBe(200); expect(result.windows[0]?.total).toBe(200);
      const clippedScope = { type: 'calendar' as const, from: '2026-10-06', to: '2026-10-07' }, clipped = await f.query({ scope: clippedScope });
      expect(clipped.windows[0]?.key).toBe(pageViewScopeKey(clippedScope));
      expect(clipped.windows[0]?.rows.map((row) => row.page_id)).toEqual(Array.from({ length: 50 }, (_, index) => id(index + 1)));
      expect(clipped.windows[0]?.total).toBe(200);
      expect(f.sqlReads.filter((read) => read.text.includes('GROUP BY selected.window_key')).every((read) => read.returned <= 50)).toBe(true);
    } finally { f.close(); }
  });
  it('redistributes unused calendar day quotas without exceeding the total preview budget', async () => {
    const f = fixture(100);
    try {
      f.setView({ view: 'calendar', dateColumnId: DATE });
      for (let row = 1; row <= 100; row++) {
        const start = Date.parse(`2026-10-${row <= 3 ? '05' : '06'}T00:00:00.000Z`);
        f.cell(row, DATE, new Date(start).toISOString());
      }
      const rows = (await f.query()).windows[0]!.rows;
      expect(rows).toHaveLength(50); expect(rows.filter((row) => Number(row.page_id.slice(3)) <= 3)).toHaveLength(3);
    } finally { f.close(); }
  });
  it('keeps Timeline period windows cursor-paginable', async () => {
    const f = fixture(100);
    try {
      f.setView({ view: 'timeline', dateColumnId: DATE });
      const start = Date.parse('2026-10-05T00:00:00.000Z');
      for (let row = 1; row <= 100; row++) f.cell(row, DATE, new Date(start).toISOString());
      const initial = await f.query(), window = initial.windows[0]!;
      expect(window.nextCursor).toBeTruthy(); expect(window.rows).toHaveLength(50);
      const next = await f.query({ scope: window.scope, cursor: window.nextCursor });
      expect(next.windows[0]?.rows.map((row) => row.page_id)).toEqual(Array.from({ length: 50 }, (_, index) => id(index + 51)));
    } finally { f.close(); }
  });
  it('returns one coherent read without retrying when a title changes after hydration', async () => {
    const f = fixture();
    try {
      let updated = false;
      const concurrentRead = async <T>(statement: { text: string; values: unknown[] }): Promise<T[]> => {
        const rows = await f.execute<T>(statement);
        if (!updated && statement.text.includes('GROUP BY selected.window_key')) {
          updated = true;
          f.database.prepare('UPDATE pages SET title=? WHERE id=?').run('Depois', id(1));
        }
        return rows;
      };
      const store = new PageViewQueryStore(concurrentRead, undefined, new PageViewQueryCursor('test-secret'));
      const result = await store.query(ROOT, VIEW, OWNER, {});
      expect(result.windows[0]?.rows[0]?.page_title).toBe('Página 1');
    } finally { f.close(); }
  });
  it('refreshes grouped metadata without hydrating any card or row cells', async () => {
    const f = fixture(120);
    try {
      f.setView({ filters: { version: 2, groupBy: [TEXT], clauses: [], passthrough: [] } });
      for (let row = 1; row <= 120; row++) f.cell(row, TEXT, `Grupo ${row}`);
      const result = await f.query({ metadataOnly: true });
      expect(result.total).toBe(120); expect(result.groups).toHaveLength(50); expect(result.windows).toEqual([]);
      expect(f.sqlReads.some((read) => read.text.includes('GROUP BY selected.window_key'))).toBe(false);
    } finally { f.close(); }
  });
  it('refreshes Board and Calendar metadata without hydrating their preview windows', async () => {
    const f = fixture(100);
    try {
      const start = Date.parse('2026-10-05T00:00:00.000Z');
      for (let row = 1; row <= 100; row++) {
        f.cell(row, SELECT, row % 2 ? A : B); f.cell(row, DATE, new Date(start).toISOString());
      }
      f.setView({ view: 'board', board: { selectColumnId: SELECT } });
      const board = await f.query({ metadataOnly: true, scope: { type: 'board', optionId: A } });
      expect(board.groups?.map((group) => group.total)).toEqual([50, 50, 0]); expect(board.windows).toEqual([]);
      f.setView({ view: 'calendar', dateColumnId: DATE });
      const calendar = await f.query({ metadataOnly: true, scope: { type: 'calendar', from: '2026-10-01', to: '2026-10-31' } });
      expect(calendar.days?.['2026-10-05']).toBe(100); expect(calendar.windows).toEqual([]);
      expect(f.sqlReads.some((read) => read.text.includes('GROUP BY selected.window_key'))).toBe(false);
    } finally { f.close(); }
  });
});

describe('filter SQL', () => {
  it('keeps quotes and wildcard characters parameterized and ignores missing columns', () => {
    const result = compileQueryFilters([{ id: TEXT, name: 'Texto', type: 'text', data: {} }], [
      { columnId: TEXT, condition: 'contains', values: ["%_'; DROP TABLE pages; --"] }, { columnId: 'missing', condition: 'equals', values: ['x'] },
    ]);
    expect(result.where.text).toContain('instr'); expect(result.where.text).not.toContain('DROP');
    expect(result.where.values).toEqual(["%_'; drop table pages; --"]);
  });
});

describe('relation snapshots and SQL links', () => {
  const RELATION = id(91000);
  it('resolves titles and aggregates only readable, active targets through the link index', async () => {
    const f = fixture(5), relations = new PageRelationRepository(f.execute);
    try {
      f.database.prepare('INSERT INTO page_columns(id,name,type,parent_id,data) VALUES (?,?,?,?,?)').run(RELATION,'Relação','relation',ROOT,'{}');
      f.cell(1, RELATION, [id(2), id(3), id(4), id(5)]);
      f.cell(2, NUMERIC, 10); f.cell(3, NUMERIC, 900); f.cell(4, NUMERIC, 100); f.cell(5, NUMERIC, '20');
      f.database.prepare('UPDATE pages SET owner_id=? WHERE id=?').run(VIEWER, id(3));
      f.database.prepare('INSERT INTO pages(id,title,owner_id,data) VALUES (?,?,?,?)').run(id(93000),'Private',VIEWER,'{}');
      f.database.prepare('UPDATE page_edges SET parent_id=? WHERE child_id=?').run(id(93000),id(3));
      f.database.prepare('UPDATE pages SET deleted_at=? WHERE id=?').run('2026-10-12', id(4));
      const visible = await relations.resolveVisibleTargets([id(2),id(3),id(4),id(5)], OWNER);
      expect(Object.keys(visible)).toEqual([id(2), id(5)]);
      for (const [operation, expected] of [['count',2],['sum',10],['min',10],['max',10]] as const) {
        expect(await relations.resolveRollupValues({data:{rollup:{version:1,relationColumnId:RELATION,targetColumnId:NUMERIC,operation}}},[id(1)],OWNER))
          .toEqual({[id(1)]:expected});
      }
      f.database.prepare('UPDATE pages SET title=? WHERE id=?').run('Título atual', id(2));
      expect((await relations.resolveVisibleTargets([id(2)],OWNER))[id(2)]?.title).toBe('Título atual');
      expect(f.database.prepare("SELECT name FROM sqlite_master WHERE name='page_relation_targets'").all()).toEqual([]);
    } finally { f.close(); }
  });
  it('preserves hidden/deleted IDs in the canonical array while editing only visible targets', async () => {
    const f = fixture(5), relations = new PageRelationRepository(f.execute);
    try {
      vi.spyOn(relations,'validateRelationConfig').mockResolvedValue();
      f.cell(1, RELATION, [id(3),id(4),id(2)]);
      f.database.prepare('UPDATE pages SET owner_id=? WHERE id=?').run(VIEWER,id(3));
      f.database.prepare('INSERT INTO pages(id,title,owner_id,data) VALUES (?,?,?,?)').run(id(93000),'Private',VIEWER,'{}');
      f.database.prepare('UPDATE page_edges SET parent_id=? WHERE child_id=?').run(id(93000),id(3));
      f.database.prepare('UPDATE pages SET deleted_at=? WHERE id=?').run('2026-10-12',id(4));
      const column = {id:RELATION,parent_id:ROOT,type:'relation',data:{relation:{version:1,targetDatabaseId:ROOT}}} as Schema.PageColumn;
      expect(await relations.prepareRelationTargets(column,id(1),[id(5)],OWNER)).toEqual([id(3),id(4),id(5)]);
      await expect(relations.prepareRelationTargets(column,id(1),[id(3)],OWNER)).rejects.toMatchObject({status:400});
    } finally { f.close(); }
  });
  it('invalidates only databases referencing the changed page through SQL links', async () => {
    const f = fixture(5), relations = new PageRelationRepository(f.execute);
    try {
      f.database.prepare('INSERT INTO page_columns(id,name,type,parent_id,data) VALUES (?,?,?,?,?)').run(RELATION,'Relação','relation',ROOT,'{}');
      f.cell(1,RELATION,[id(2)]);
      expect(await relations.invalidateDatabasesReferencingPage(id(2))).toEqual([{pageId:ROOT}]);
      expect(await relations.invalidateDatabasesReferencingPage(id(3))).toEqual([]);
      expect(await relations.invalidateDatabasesReferencingDatabase(ROOT)).toEqual([{pageId:ROOT}]);
    } finally { f.close(); }
  });
});
