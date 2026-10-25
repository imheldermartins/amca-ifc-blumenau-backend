import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceVariableStore } from './workspace-variable-repository.js';
import { WorkspaceVariableController } from '@/controllers/workspace-variable-controller';
vi.mock('@models/index', () => ({ default: {} }));
vi.mock('@/repositories/scoped-access-repository', () => ({ accessGuard: (_type: string, _id: string, user: string) => ({ text: "? = 'writer'", values: [user] }) }));
vi.mock('@/repositories/workspace-repository', () => ({ default: { getForUser: vi.fn() } }));

describe('workspace variables', () => {
  let sql: DatabaseSync; let store: WorkspaceVariableStore;
  beforeEach(() => {
    sql = new DatabaseSync(':memory:'); sql.exec("CREATE TABLE workspaces(id TEXT PRIMARY KEY,data TEXT,updated_at TEXT); INSERT INTO workspaces VALUES('w','{\"keep\":{\"nested\":1}}',NULL)");
    store = new WorkspaceVariableStore(async <T>(statement: string | SqlStatement) => {
      if (typeof statement === 'string') throw new Error('Expected bound statement');
      return sql.prepare(statement.text).all(...statement.values as SQLInputValue[]) as T[];
    });
  });
  afterEach(() => sql.close());
  const data = () => JSON.parse(sql.prepare('SELECT data FROM workspaces').get()!.data as string);
  it('merges one literal key and preserves unrelated metadata and other variable writes', async () => {
    expect(await store.set('w', 'writer', 'a.b["quote"]', 'text')).toBe(true);
    await store.set('w', 'writer', 'other', '');
    expect(data()).toEqual({ keep: { nested: 1 }, 'a.b["quote"]': 'text', other: '' });
    await store.set('w', 'writer', 'a.b["quote"]', null);
    expect(data()).toEqual({ keep: { nested: 1 }, other: '' });
  });
  it('rejects unauthorized writes atomically', async () => {
    expect(await store.set('w', 'reader', 'keep', 'overwrite')).toBe(false);
    expect(data()).toEqual({ keep: { nested: 1 } });
  });
  it('validates text values, key size and protected object keys before writing', async () => {
    const write = vi.spyOn(store, 'set'); const controller = new WorkspaceVariableController(store); const id = '01M00000000000000000000001';
    for (const body of [{ key: 'x', value: {} }, { key: 'x' }, { key: '__proto__', value: 'x' }, { key: 'x'.repeat(121), value: 'x' }, { key: 'x', value: 'x', unexpected: 1 }]) {
      expect(await controller.set(id, 'writer', body)).toMatchObject({ ok: false, reason: 'validation' });
    }
    expect(write).not.toHaveBeenCalled();
  });
});
