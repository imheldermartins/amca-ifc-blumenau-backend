import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import { migration as initial } from './migrations/20260924235507356_619638ca_initial_schema_from_decorators.js';
import { migration as timestamps } from './migrations/20260926211058243_9a36cd7b_repair_literal_updated_at.js';
import { migration as schedule } from './migrations/20260928231611832_eef4196a_add_pinned_schedule_pages.js';
import { migration as notifications } from './migrations/20260930002722501_55bb4d04_add_schedule_notifications.js';
import { migration as flow } from './migrations/20260930031603388_4569bf7a_add_flow_columns_and_single_page_parent.js';

const ids = {
  user: '01K89WJ7X00000000000000000',
  parentA: '01K89WJ7X00000000000000001',
  parentB: '01K89WJ7X00000000000000002',
  child: '01K89WJ7X00000000000000003',
  roleDefault: '01K89WJ7X00000000000000004',
  roleCustom: '01K89WJ7X00000000000000005',
  edgeA: '01K89WJ7X00000000000000006',
  edgeB: '01K89WJ7X00000000000000007',
  flowColumn: '01K89WJ7X00000000000000008',
} as const;

const databases: DatabaseSync[] = [];

function applyStatements(sqlite: DatabaseSync, statements: readonly string[]) {
  sqlite.exec('BEGIN');
  try {
    for (const statement of statements) sqlite.exec(statement);
    sqlite.exec('COMMIT');
  } catch (error) {
    sqlite.exec('ROLLBACK');
    throw error;
  }
}

function databaseBeforeFlow() {
  const sqlite = new DatabaseSync(':memory:');
  databases.push(sqlite);
  sqlite.exec('PRAGMA foreign_keys = ON');
  for (const migration of [initial, timestamps, schedule, notifications]) {
    applyStatements(sqlite, migration.up);
  }
  sqlite.prepare('INSERT INTO users (id, email) VALUES (?, ?)').run(ids.user, 'flow@example.com');
  const insertPage = sqlite.prepare('INSERT INTO pages (id, title, owner_id) VALUES (?, ?, ?)');
  insertPage.run(ids.parentA, 'Parent A', ids.user);
  insertPage.run(ids.parentB, 'Parent B', ids.user);
  insertPage.run(ids.child, 'Child', ids.user);
  return sqlite;
}

afterEach(() => {
  for (const sqlite of databases.splice(0)) sqlite.close();
});

describe('flow and single-parent migration', () => {
  it('adds Flow, backfills only the active default role and enforces one parent', () => {
    const sqlite = databaseBeforeFlow();
    const permissions = JSON.stringify({ read: ['view'], write: ['update'] });
    sqlite.prepare(
      'INSERT INTO page_roles (id, page_id, name, roles, is_default, system_key) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(ids.roleDefault, ids.parentA, 'Default', permissions, 1, 'default');
    sqlite.prepare(
      'INSERT INTO page_roles (id, page_id, name, roles, is_default, system_key) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(ids.roleCustom, ids.parentA, 'Custom', permissions, 0, null);
    sqlite.prepare('INSERT INTO page_edges (id, parent_id, child_id) VALUES (?, ?, ?)').run(
      ids.edgeA,
      ids.parentA,
      ids.child,
    );

    applyStatements(sqlite, flow.up);

    const defaultRole = sqlite.prepare('SELECT roles FROM page_roles WHERE id = ?').get(ids.roleDefault) as {
      roles: string;
    };
    const customRole = sqlite.prepare('SELECT roles FROM page_roles WHERE id = ?').get(ids.roleCustom) as {
      roles: string;
    };
    expect(JSON.parse(defaultRole.roles).write).toEqual(['update', 'lock_columns']);
    expect(JSON.parse(customRole.roles).write).toEqual(['update']);

    expect(() =>
      sqlite.prepare('INSERT INTO page_edges (id, parent_id, child_id) VALUES (?, ?, ?)').run(
        ids.edgeB,
        ids.parentB,
        ids.child,
      ),
    ).toThrow(/UNIQUE constraint failed: page_edges\.child_id/);
    expect(() =>
      sqlite.prepare('INSERT INTO page_columns (id, name, type, parent_id) VALUES (?, ?, ?, ?)').run(
        ids.flowColumn,
        'Approval flow',
        'flow',
        ids.parentA,
      ),
    ).not.toThrow();
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('fails instead of silently repairing pages that already have two parents', () => {
    const sqlite = databaseBeforeFlow();
    const insertEdge = sqlite.prepare('INSERT INTO page_edges (id, parent_id, child_id) VALUES (?, ?, ?)');
    insertEdge.run(ids.edgeA, ids.parentA, ids.child);
    insertEdge.run(ids.edgeB, ids.parentB, ids.child);

    expect(() => applyStatements(sqlite, flow.up)).toThrow(/UNIQUE constraint failed/);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM page_edges WHERE child_id = ?').get(ids.child)).toEqual({
      count: 2,
    });
  });
});
