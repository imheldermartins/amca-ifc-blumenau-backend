import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrganizationVariableStore } from './organization-variable-repository.js';
import { OrganizationVariableController } from '@/controllers/organization-variable-controller';
vi.mock('@models/index', () => ({ default: {} }));
vi.mock('@/repositories/scoped-access-repository', () => ({ accessGuard: (_scope: string, _id: string, user: string) => ({ text: "? = 'writer'", values: [user] }) }));
vi.mock('@/repositories/organization-repository', () => ({ default: { getForUser: vi.fn() } }));
describe('organization text variables', () => {
  let sql: DatabaseSync, store: OrganizationVariableStore;
  beforeEach(() => {
    sql = new DatabaseSync(':memory:'); sql.exec("CREATE TABLE organizations(id TEXT PRIMARY KEY,data TEXT,updated_at TEXT); INSERT INTO organizations VALUES('o','{\"metadata\":{\"keep\":true}}',NULL)");
    store = new OrganizationVariableStore(async <T>(statement: string | SqlStatement) => {
      if (typeof statement === 'string') throw new Error('Expected binds');
      return sql.prepare(statement.text).all(...statement.values as SQLInputValue[]) as T[];
    });
  });
  afterEach(() => sql.close());
  const data = () => JSON.parse(sql.prepare('SELECT data FROM organizations').get()!.data as string);
  it('saves literal keys and text, preserves other fields and removes only the selected variable', async () => {
    expect(await store.set('o', 'writer', 'a.b["x"]', 'texto')).toBe(true);
    await store.set('o', 'writer', 'empty', '');
    expect(data()).toEqual({ metadata: { keep: true }, 'a.b["x"]': 'texto', empty: '' });
    await store.set('o', 'writer', 'a.b["x"]', null);
    expect(data()).toEqual({ metadata: { keep: true }, empty: '' });
  });
  it('rejects readers atomically and validates the same input contract as workspace variables', async () => {
    expect(await store.set('o', 'reader', 'x', 'value')).toBe(false);
    const controller = new OrganizationVariableController(store), set = vi.spyOn(store, 'set');
    for (const body of [{ key: '__proto__', value: 'x' }, { key: 'x', value: {} }, { key: 'x' }]) {
      expect(await controller.set('01M00000000000000000000001', 'writer', body)).toMatchObject({ ok: false, reason: 'validation' });
    }
    expect(set).not.toHaveBeenCalled(); expect(data()).toEqual({ metadata: { keep: true } });
  });
});
