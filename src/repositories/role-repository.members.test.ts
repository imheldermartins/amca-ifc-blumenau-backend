import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ulid } from 'ulid';
const transport = vi.hoisted(() => ({ rqlite: vi.fn() }));
vi.mock('@/db/client-db', () => ({ rqlite: transport.rqlite }));
import { RoleStore } from './role-repository.js';
import { ACCESS_SCOPES, fullPermissions } from '@/services/auth/permissions';

describe.each(ACCESS_SCOPES)('remoção de colaboradores: %s', (scope) => {
  let sqlite: DatabaseSync;
  const owner = ulid(), manager = ulid(), member = ulid(), powerful = ulid(), scopeId = ulid();
  const managerRole = ulid(), readerRole = ulid(), powerfulRole = ulid();
  const table = scope === 'page' ? 'page_collaborators' : `${scope}_members`;
  const store = new RoleStore();
  const managerPermissions = { read: ['view', 'members'], write: ['remove_members'] };
  function execute(statements: RqliteStatement[]) {
    return statements.map(([text, ...values]) => sqlite.prepare(String(text)).run(...values as Array<string | number | null>).changes > 0);
  }
  beforeEach(() => {
    sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`CREATE TABLE users (id TEXT PRIMARY KEY);
      CREATE TABLE organizations (id TEXT PRIMARY KEY, owner_id TEXT);
      CREATE TABLE workspaces (id TEXT PRIMARY KEY, created_by_user_id TEXT, organization_id TEXT);
      CREATE TABLE pages (id TEXT PRIMARY KEY, owner_id TEXT, deleted_at TEXT);
      CREATE TABLE page_edges (parent_id TEXT, child_id TEXT);`);
    for (const context of ACCESS_SCOPES) {
      const memberships = context === 'page' ? 'page_collaborators' : `${context}_members`;
      sqlite.exec(`CREATE TABLE ${context}_roles (id TEXT PRIMARY KEY, ${context}_id TEXT, roles TEXT, deleted_at TEXT);
        CREATE TABLE ${memberships} (id TEXT PRIMARY KEY, ${context}_id TEXT, user_id TEXT, ${context}_member_role_id TEXT, deleted_at TEXT, updated_at TEXT, page_root_id TEXT);`);
    }
    for (const id of [owner, manager, member, powerful]) sqlite.prepare('INSERT INTO users VALUES (?)').run(id);
    const resource = scope === 'page' ? 'pages' : scope === 'workspace' ? 'workspaces' : 'organizations';
    const ownerColumn = scope === 'workspace' ? 'created_by_user_id' : 'owner_id';
    sqlite.prepare(`INSERT INTO ${resource} (id,${ownerColumn}) VALUES (?,?)`).run(scopeId, owner);
    sqlite.prepare('INSERT INTO pages (id, owner_id) VALUES (?,?)').run(member, member);
    for (const [id, permissions] of [[managerRole, managerPermissions], [readerRole, { read: ['view'], write: [] }], [powerfulRole, fullPermissions(scope)]] as const) {
      sqlite.prepare(`INSERT INTO ${scope}_roles (id,${scope}_id,roles) VALUES (?,?,?)`).run(id, scopeId, JSON.stringify(permissions));
    }
    for (const [id, role] of [[owner, powerfulRole], [manager, managerRole], [member, readerRole], [powerful, powerfulRole]]) {
      sqlite.prepare(`INSERT INTO ${table} (id,${scope}_id,user_id,${scope}_member_role_id,page_root_id) VALUES (?,?,?,?,?)`).run(ulid(), scopeId, id!, role!, member);
    }
    transport.rqlite.mockReset();
    transport.rqlite.mockImplementation(async (statements) => execute(statements));
  });
  afterEach(() => sqlite.close());
  it('owner remove o vínculo sem apagar o conteúdo, e uma segunda remoção falha', async () => {
    expect(await store.removeMember(scope, scopeId, owner, member)).toBe(true);
    expect(await store.removeMember(scope, scopeId, owner, member)).toBe(false);
    expect(sqlite.prepare('SELECT deleted_at FROM pages WHERE id = ?').get(member)?.deleted_at).toBeNull();
  });
  it('exige remove_members; alterar roles não autoriza remover', async () => {
    sqlite.prepare(`UPDATE ${scope}_roles SET roles = ? WHERE id = ?`).run(JSON.stringify({ read: ['view', 'members'], write: ['promote_members'] }), managerRole);
    expect(await store.removeMember(scope, scopeId, manager, member)).toBe(false);
    sqlite.prepare(`UPDATE ${scope}_roles SET roles = ? WHERE id = ?`).run(JSON.stringify(managerPermissions), managerRole);
    expect(await store.removeMember(scope, scopeId, manager, member)).toBe(true);
  });
  it('protege o proprietário e membros com permissões superiores', async () => {
    expect(await store.removeMember(scope, scopeId, owner, owner)).toBe(false);
    expect(await store.removeMember(scope, scopeId, manager, owner)).toBe(false);
    expect(await store.removeMember(scope, scopeId, manager, powerful)).toBe(false);
  });
  it('reavalia uma permissão revogada no momento da escrita', async () => {
    transport.rqlite.mockImplementationOnce(async (statements) => {
      sqlite.prepare(`UPDATE ${scope}_roles SET roles = ? WHERE id = ?`).run(JSON.stringify({ read: ['view'], write: [] }), managerRole);
      return execute(statements);
    });
    expect(await store.removeMember(scope, scopeId, manager, member)).toBe(false);
    expect(sqlite.prepare(`SELECT deleted_at FROM ${table} WHERE user_id = ?`).get(member)?.deleted_at).toBeNull();
  });
});
