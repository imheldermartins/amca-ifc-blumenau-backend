import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const execute = vi.hoisted(() => vi.fn());
vi.mock('../db/client-db.js', () => ({ default: execute, rqlite: vi.fn() }));

import { migration as originalRepairMigration } from '../db/migrations/20260926211058243_9a36cd7b_repair_literal_updated_at.js';
import { migration as recurringRepairMigration } from '../db/migrations/20261023111924265_4ce7353b_repair_recurring_users_updated_at.js';
import { migration as timestampGuardMigration } from '../db/migrations/20261023112039308_a7aeaa20_normalize_literal_users_updated_at.js';
import { Model } from './model.js';

const timestampedTables = originalRepairMigration.up.map((statement) => {
  const match = /^UPDATE ([a-z_]+) SET updated_at/.exec(statement);
  if (!match) throw new Error(`Migration statement sem tabela reconhecível: ${statement}`);
  return match[1]!;
});

describe('regressão de updated_at', () => {
  beforeEach(() => execute.mockReset());

  it.each(timestampedTables)('%s usa CURRENT_TIMESTAMP como expressão, nunca como bind', async (table) => {
    execute.mockResolvedValueOnce(true);
    const model = new Model<{ id: string; value: string; updated_at: string }>(table);

    await expect(model.update({ value: 'novo' }, { id: 'registro' })).resolves.toBe(true);

    const statement = execute.mock.calls[0]?.[0] as SqlStatement;
    expect(statement.text).toContain('updated_at = CURRENT_TIMESTAMP');
    expect(statement.text).not.toContain('updated_at = ?');
    expect(statement.values).toEqual(['novo', 'registro']);
  });

  it('repara o literal legado em todas as tabelas com updated_at sem alterar o schema', () => {
    const sqlite = new DatabaseSync(':memory:');
    try {
      for (const table of timestampedTables) {
        sqlite.exec(`CREATE TABLE ${table} (id TEXT PRIMARY KEY, created_at TEXT, updated_at TEXT)`);
        sqlite.prepare(`INSERT INTO ${table} (id, created_at, updated_at) VALUES (?, ?, ?)`)
          .run('registro', '2026-09-26 20:55:33', ' CURRENT_TIMESTAMP ');
      }

      for (const statement of originalRepairMigration.up) sqlite.exec(statement);

      for (const table of timestampedTables) {
        expect(sqlite.prepare(`SELECT updated_at FROM ${table} WHERE id = ?`).get('registro'))
          .toEqual({ updated_at: '2026-09-26 20:55:33' });
      }
    } finally {
      sqlite.close();
    }
  });

  it('repara users novamente e impede que o literal volte a permanecer gravado', () => {
    const sqlite = new DatabaseSync(':memory:');
    try {
      sqlite.exec(`CREATE TABLE users (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
      sqlite.prepare('INSERT INTO users (id, created_at, updated_at) VALUES (?, ?, ?)')
        .run('usuario', '2026-10-12 16:30:35', 'CURRENT_TIMESTAMP');

      for (const statement of recurringRepairMigration.up) sqlite.exec(statement);
      expect(sqlite.prepare('SELECT updated_at FROM users WHERE id = ?').get('usuario'))
        .toEqual({ updated_at: '2026-10-12 16:30:35' });

      for (const statement of timestampGuardMigration.up) sqlite.exec(statement);
      sqlite.prepare('UPDATE users SET updated_at = ? WHERE id = ?')
        .run('CURRENT_TIMESTAMP', 'usuario');

      const row = sqlite.prepare('SELECT updated_at FROM users WHERE id = ?').get('usuario') as { updated_at: string };
      expect(row.updated_at).not.toBe('CURRENT_TIMESTAMP');
      expect(Number.isNaN(Date.parse(`${row.updated_at}Z`))).toBe(false);
    } finally {
      sqlite.close();
    }
  });
});
