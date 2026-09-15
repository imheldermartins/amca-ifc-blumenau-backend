import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const doubles = vi.hoisted(() => ({ rqlite: vi.fn(), sql: vi.fn() }));
vi.mock('./shared.js', () => ({ default: doubles.sql, rqlite: doubles.rqlite }));

import { Model } from './model.js';
import { pageChildEdgeStatement } from './page-child-creation.js';
import { pageActivityTouchStatement, readPageLatestUpdatedAt } from './page-activity.js';
import { SystemRoleFactory } from './system-role-factory.js';

const PAGE_ID = '01KXVZ00000000000000000001';
const CELL_ID = '01KXVZ00000000000000000002';
const MISSING_ID = '01KXVZ00000000000000000003';
let sqlite: DatabaseSync;

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE pages (
    id TEXT PRIMARY KEY CHECK(length(id) = 26),
    owner_id TEXT NOT NULL,
    title TEXT,
    data TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT
  );
  CREATE TABLE page_columns_values (
    id TEXT PRIMARY KEY,
    data TEXT,
    updated_at TEXT
  );
  CREATE TABLE page_roles (
    id TEXT PRIMARY KEY,
    page_id TEXT,
    name TEXT,
    roles TEXT,
    is_default INTEGER,
    system_key TEXT,
    deleted_at TEXT
  );
  CREATE TABLE page_edges (
    id TEXT PRIMARY KEY,
    parent_id TEXT,
    child_id TEXT
  );`);
  sqlite.prepare('INSERT INTO pages (id, owner_id, data) VALUES (?, ?, ?)').run(PAGE_ID, 'owner', 'original');
  sqlite.prepare('INSERT INTO page_columns_values (id, data) VALUES (?, ?)').run(CELL_ID, 'old');

  doubles.rqlite.mockReset();
  doubles.sql.mockReset();
  doubles.sql.mockImplementation(async (statement: SqlStatement) =>
    sqlite.prepare(statement.text).all(...statement.values as Array<string | number | null>));
  doubles.rqlite.mockImplementation(async (statements: RqliteStatement[], endpoint: string, options?: { transaction: boolean }) => {
    if (endpoint === 'query') return statements.map(([text, ...values]) =>
      sqlite.prepare(String(text)).all(...values as Array<string | number | null>));
    expect(options?.transaction).toBe(true);
    sqlite.exec('BEGIN');
    try {
      const results = statements.map(([text, ...values]) => {
        const prepared = sqlite.prepare(String(text));
        return /^\s*SELECT\b/i.test(String(text))
          ? prepared.all(...values as Array<string | number | null>)
          : prepared.run(...values as Array<string | number | null>).changes > 0;
      });
      sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      sqlite.exec('ROLLBACK');
      throw error;
    }
  });
});

afterEach(() => sqlite.close());

describe('Model mutation with unified page activity', () => {
  it('grava célula e relógio juntos quando a escrita é efetiva', async () => {
    const cells = new Model<{ id: string; data: string; updated_at: string }>('page_columns_values');
    await expect(cells.update({ data: 'new' }, { id: CELL_ID }, {
      after: [pageActivityTouchStatement(PAGE_ID)],
    })).resolves.toBe(true);

    expect(sqlite.prepare('SELECT data FROM page_columns_values WHERE id = ?').get(CELL_ID)?.data).toBe('new');
    expect(await readPageLatestUpdatedAt(PAGE_ID)).not.toBeNull();
  });

  it('reverte escrita anterior quando a célula não existe', async () => {
    const cells = new Model<{ id: string; data: string; updated_at: string }>('page_columns_values');
    await expect(cells.update({ data: 'new' }, { id: MISSING_ID }, {
      before: [{ text: 'UPDATE pages SET data = ? WHERE id = ?', values: ['reserved', PAGE_ID] }],
      after: [pageActivityTouchStatement(PAGE_ID)],
    })).rejects.toThrow();

    expect(sqlite.prepare('SELECT data FROM pages WHERE id = ?').get(PAGE_ID)?.data).toBe('original');
    expect(await readPageLatestUpdatedAt(PAGE_ID)).toBeNull();
  });

  it('reverte a célula quando a página do relógio desapareceu', async () => {
    const cells = new Model<{ id: string; data: string; updated_at: string }>('page_columns_values');
    await expect(cells.update({ data: 'new' }, { id: CELL_ID }, {
      after: [pageActivityTouchStatement(MISSING_ID)],
    })).rejects.toThrow();

    expect(sqlite.prepare('SELECT data FROM page_columns_values WHERE id = ?').get(CELL_ID)?.data).toBe('old');
  });

  it('atualiza e lê o título confirmado na mesma transação', async () => {
    const pages = new Model<{ id: string; owner_id: string; title: string | null; data: string }>('pages');

    await expect(pages.updateAndFind(
      { title: 'Título confirmado' },
      { id: PAGE_ID },
      { after: [pageActivityTouchStatement(PAGE_ID)] },
    )).resolves.toMatchObject({ id: PAGE_ID, title: 'Título confirmado' });

    expect(doubles.rqlite).toHaveBeenCalledWith(
      expect.arrayContaining([expect.arrayContaining([expect.stringMatching(/^SELECT\b/)])]),
      'request',
      { transaction: true },
    );
    expect(doubles.sql).not.toHaveBeenCalled();
  });

  it('cria a linha, a role, a aresta e o relógio em uma transação', async () => {
    const pages = new Model<{ id: string; owner_id: string; title: string; data: string }>('pages');
    const child = await pages.create({ id: MISSING_ID, owner_id: 'owner', title: 'Linha', data: '{}' } as unknown as CreateValues<{ id: string; owner_id: string; title: string; data: string }>, {
      after: [
        SystemRoleFactory.defaultStatement('page', MISSING_ID),
        pageChildEdgeStatement(PAGE_ID, MISSING_ID),
        pageActivityTouchStatement(PAGE_ID),
      ],
    });

    expect(child?.id).toBe(MISSING_ID);
    expect(doubles.rqlite).toHaveBeenCalledWith(
      expect.arrayContaining([expect.arrayContaining([expect.stringMatching(/^SELECT\b/)])]),
      'request',
      { transaction: true },
    );
    expect(doubles.sql).not.toHaveBeenCalled();
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM page_roles WHERE page_id = ?').get(MISSING_ID)?.count).toBe(1);
    expect(sqlite.prepare('SELECT parent_id FROM page_edges WHERE child_id = ?').get(MISSING_ID)?.parent_id).toBe(PAGE_ID);
    expect(await readPageLatestUpdatedAt(PAGE_ID)).not.toBeNull();
  });

  it('não deixa página ou role órfã se a aresta não puder ser criada', async () => {
    const pages = new Model<{ id: string; owner_id: string; title: string; data: string }>('pages');
    await expect(pages.create({ id: MISSING_ID, owner_id: 'owner', title: 'Linha', data: '{}' } as unknown as CreateValues<{ id: string; owner_id: string; title: string; data: string }>, {
      after: [
        SystemRoleFactory.defaultStatement('page', MISSING_ID),
        pageChildEdgeStatement(CELL_ID, MISSING_ID),
        pageActivityTouchStatement(CELL_ID),
      ],
    })).rejects.toThrow();

    expect(sqlite.prepare('SELECT id FROM pages WHERE id = ?').get(MISSING_ID)).toBeUndefined();
    expect(sqlite.prepare('SELECT id FROM page_roles WHERE page_id = ?').get(MISSING_ID)).toBeUndefined();
  });

  it('deriva a última edição das descendentes e ignora páginas apagadas', async () => {
    expect(await readPageLatestUpdatedAt(PAGE_ID)).toBeNull();
    sqlite.prepare('INSERT INTO pages (id, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(CELL_ID, 'owner', '2026-09-14 10:00:00', '2026-09-14 11:00:00');
    sqlite.prepare('INSERT INTO page_edges (id, parent_id, child_id) VALUES (?, ?, ?)')
      .run('edge-1', PAGE_ID, CELL_ID);
    sqlite.prepare('INSERT INTO pages (id, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(MISSING_ID, 'owner', '2026-09-14 10:00:00', '2026-09-14 12:00:00');
    sqlite.prepare('INSERT INTO page_edges (id, parent_id, child_id) VALUES (?, ?, ?)')
      .run('edge-2', CELL_ID, MISSING_ID);
    expect(await readPageLatestUpdatedAt(PAGE_ID)).toBe('2026-09-14 12:00:00');
    sqlite.prepare('UPDATE pages SET deleted_at = ? WHERE id = ?').run('2026-09-14 13:00:00', MISSING_ID);
    expect(await readPageLatestUpdatedAt(PAGE_ID)).toBe('2026-09-14 11:00:00');
  });
});
