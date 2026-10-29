import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ulid } from 'ulid';
const transport = vi.hoisted(() => ({ rqlite: vi.fn() }));
vi.mock('@/db/client-db', () => ({ rqlite: transport.rqlite }));
import store from './access-invite-repository.js';
import access from './scoped-access-repository.js';
import { fullPermissions, type AccessScope } from '@/services/auth/permissions';

describe('roles exclusivas dos convites', () => {
  let sqlite: DatabaseSync;
  const owner = ulid(), alice = ulid(), bob = ulid(), organization = ulid(), workspace = ulid();
  const page = ulid(), sibling = ulid(), pageTemplate = ulid(), workspaceTemplate = ulid(), organizationTemplate = ulid();
  const reader = { read: ['view'], write: [] };
  const query = (sql: string, ...values: Array<string | number | null>) => sqlite.prepare(sql).all(...values);
  const run = (sql: string, ...values: Array<string | number | null>) => sqlite.prepare(sql).run(...values);

  beforeEach(() => {
    sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, email_verified_at TEXT);
      CREATE TABLE organizations (id TEXT PRIMARY KEY, name TEXT, owner_id TEXT);
      CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT, organization_id TEXT, created_by_user_id TEXT);
      CREATE TABLE pages (id TEXT PRIMARY KEY, title TEXT, owner_id TEXT, data TEXT, deleted_at TEXT);
      CREATE TABLE page_edges (parent_id TEXT, child_id TEXT);
      CREATE TABLE access_invites (id TEXT PRIMARY KEY, token_hash TEXT UNIQUE, token_hint TEXT, scope_type TEXT,
        scope_id TEXT, role_id TEXT, recipient_email TEXT, author_id TEXT, status TEXT, expires_at TEXT,
        acceptance_limit INTEGER, acceptance_count INTEGER DEFAULT 0, notified_at TEXT, deleted_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE access_invite_acceptances (id TEXT PRIMARY KEY, invite_id TEXT, user_id TEXT, UNIQUE(invite_id,user_id));`);
    for (const scope of ['organization', 'workspace', 'page'] as const) {
      const members = scope === 'page' ? 'page_collaborators' : `${scope}_members`;
      sqlite.exec(`CREATE TABLE ${scope}_roles (id TEXT PRIMARY KEY, ${scope}_id TEXT, name TEXT, roles TEXT,
        is_default INTEGER DEFAULT 0, system_key TEXT, deleted_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE UNIQUE INDEX ${scope}_system ON ${scope}_roles (${scope}_id,system_key) WHERE system_key IS NOT NULL AND deleted_at IS NULL;
        CREATE TABLE ${members} (id TEXT PRIMARY KEY, ${scope}_id TEXT, user_id TEXT, ${scope}_member_role_id TEXT,
          page_root_id TEXT, deleted_at TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE UNIQUE INDEX ${scope}_member ON ${members} (${scope}_id,user_id) WHERE deleted_at IS NULL;`);
    }
    for (const [id, email] of [[owner, 'owner@example.test'], [alice, 'alice@example.test'], [bob, 'bob@example.test']]) {
      run('INSERT INTO users VALUES (?,?,?,CURRENT_TIMESTAMP)', id!, id!, email!);
    }
    run('INSERT INTO organizations VALUES (?,?,?)', organization, 'Organização', owner);
    run('INSERT INTO workspaces VALUES (?,?,?,?)', workspace, 'Workspace', organization, owner);
    for (const id of [workspace, page, sibling]) run('INSERT INTO pages (id,title,owner_id) VALUES (?,?,?)', id, 'Página', owner);
    for (const child of [page, sibling]) run('INSERT INTO page_edges VALUES (?,?)', workspace, child);
    run('INSERT INTO workspace_roles (id,workspace_id,name,roles,is_default,system_key) VALUES (?,?,?,?,1,?)',
      workspace, workspace, 'Default', JSON.stringify(fullPermissions('workspace')), 'default');
    run('INSERT INTO workspace_members (id,workspace_id,user_id,workspace_member_role_id,page_root_id) VALUES (?,?,?,?,?)',
      ulid(), workspace, owner, workspace, workspace);
    for (const [scope, id, scopeId] of [['page', pageTemplate, page], ['workspace', workspaceTemplate, workspace], ['organization', organizationTemplate, organization]] as const) {
      run(`INSERT INTO ${scope}_roles (id,${scope}_id,name,roles) VALUES (?,?,?,?)`, id, scopeId, 'Leitor', JSON.stringify(reader));
    }
    transport.rqlite.mockReset();
    transport.rqlite.mockImplementation(async (statements: RqliteStatement[], mode: string, options?: { transaction?: boolean }) => {
      if (options?.transaction) sqlite.exec('BEGIN');
      try {
        const result = statements.map((statement) => {
          const [sql, ...values] = typeof statement === 'string' ? [statement] : statement;
          const parameters = values as Array<string | number | null>;
          return mode === 'query' ? query(String(sql), ...parameters) : run(String(sql), ...parameters).changes > 0;
        });
        if (options?.transaction) sqlite.exec('COMMIT');
        return result;
      } catch (error) {
        if (options?.transaction) sqlite.exec('ROLLBACK');
        throw error;
      }
    });
  });
  afterEach(() => sqlite.close());

  async function invite(scope: AccessScope, recipientEmail: string | null = 'alice@example.test', acceptanceLimit: number | null = 1) {
    const id = ulid();
    expect(await store.create({ id, tokenHash: id.padEnd(64, '0'), tokenHint: 'hint', scope,
      scopeId: scope === 'page' ? page : scope === 'workspace' ? workspace : organization,
      roleId: scope === 'page' ? pageTemplate : scope === 'workspace' ? workspaceTemplate : organizationTemplate,
      recipientEmail, authorId: owner, expiresAt: null, acceptanceLimit })).toBe(true);
    return (await store.getById(id))!;
  }
  const membershipRole = (scope: AccessScope, userId: string) => {
    const members = scope === 'page' ? 'page_collaborators' : `${scope}_members`;
    return query(`SELECT role.* FROM ${scope}_roles role JOIN ${members} member
      ON member.${scope}_member_role_id = role.id WHERE member.user_id = ? AND member.deleted_at IS NULL`, userId)[0]!;
  };

  it('isola a role de cada convite e limita o novo colaborador à página convidada', async () => {
    const first = await invite('page'), second = await invite('page', 'bob@example.test');
    expect(first.roleId).not.toBe(pageTemplate);
    expect(second.roleId).not.toBe(first.roleId);
    run('UPDATE page_roles SET roles = ? WHERE id = ?', JSON.stringify(fullPermissions('page')), pageTemplate);
    expect(await store.acceptById(first.id, alice)).toBe(true);
    expect(await store.acceptById(second.id, bob)).toBe(true);
    for (const scope of ['organization', 'workspace', 'page'] as const) {
      const a = membershipRole(scope, alice), b = membershipRole(scope, bob);
      expect(a.id).not.toBe(b.id);
      expect(a.system_key).toBe(`invite:${first.id}`);
      expect(b.system_key).toBe(`invite:${second.id}`);
      expect(JSON.parse(a.roles as string)).toEqual(reader);
    }
    expect(await access.can('page', page, alice, 'read', 'view')).toBe(true);
    expect(await access.can('page', sibling, alice, 'read', 'view')).toBe(false);
    expect(await access.can('page', page, alice, 'write', 'update')).toBe(false);
    expect(await access.can('workspace', workspace, alice, 'write', 'manage_pages')).toBe(false);
    expect(await access.can('organization', organization, alice, 'read', 'workspaces')).toBe(false);
    expect(await access.can('page', sibling, owner, 'write', 'update')).toBe(true);
    run('UPDATE page_roles SET roles = ? WHERE id = ?', JSON.stringify(fullPermissions('page')), first.roleId);
    expect(await access.can('page', page, alice, 'write', 'update')).toBe(true);
    expect(await access.can('page', page, bob, 'write', 'update')).toBe(false);
  });

  it('copia a role do convite de workspace e cria role de organização exclusiva e mínima', async () => {
    const record = await invite('workspace');
    expect(record.roleId).not.toBe(workspaceTemplate);
    expect(await store.acceptById(record.id, alice)).toBe(true);
    expect(membershipRole('workspace', alice).id).toBe(record.roleId);
    expect(JSON.parse(membershipRole('organization', alice).roles as string)).toEqual(reader);
    expect(await access.can('workspace', workspace, alice, 'read', 'view')).toBe(true);
    expect(await access.can('page', page, alice, 'read', 'view')).toBe(false);
  });

  it('corrige o aceite de um convite pendente antigo sem trocar seu token', async () => {
    const id = ulid(), hash = id.padEnd(64, '0');
    run(`INSERT INTO access_invites (id,token_hash,scope_type,scope_id,role_id,recipient_email,author_id,status,acceptance_limit)
      VALUES (?,?,'page',?,?,?,?,'pending',1)`, id, hash, page, pageTemplate, 'alice@example.test', owner);
    expect(await store.acceptById(id, alice)).toBe(true);
    const record = (await store.getByTokenHash(hash))!;
    expect(record.roleId).not.toBe(pageTemplate);
    expect(record.roleId).toBe(membershipRole('page', alice).id);
    expect(await access.can('page', sibling, alice, 'read', 'view')).toBe(false);
  });

  it('preserva vínculos e permissões existentes na organização e no workspace', async () => {
    run('INSERT INTO organization_roles (id,organization_id,name,roles) VALUES (?,?,?,?)', organization, organization, 'Gestor', JSON.stringify(fullPermissions('organization')));
    run('INSERT INTO organization_members (id,organization_id,user_id,organization_member_role_id) VALUES (?,?,?,?)', ulid(), organization, alice, organization);
    run('INSERT INTO workspace_members (id,workspace_id,user_id,workspace_member_role_id,page_root_id) VALUES (?,?,?,?,?)', ulid(), workspace, alice, workspace, ulid());
    const record = await invite('page');
    expect(await store.acceptById(record.id, alice)).toBe(true);
    expect(membershipRole('organization', alice).id).toBe(organization);
    expect(membershipRole('workspace', alice).id).toBe(workspace);
  });

  it('mantém uma role por convite genérico e não conta o aceite repetido', async () => {
    const record = await invite('page', null, 2);
    expect(await store.acceptById(record.id, alice)).toBe(true);
    expect(await store.acceptById(record.id, alice)).toBe(true);
    expect((await store.getById(record.id))?.acceptanceCount).toBe(1);
    expect(await store.acceptById(record.id, bob)).toBe(true);
    expect(membershipRole('page', alice).id).toBe(membershipRole('page', bob).id);
    expect(query('SELECT id FROM workspace_roles WHERE system_key = ?', `invite:${record.id}`)).toHaveLength(1);
    expect((await store.getById(record.id))?.acceptanceCount).toBe(2);
  });

  it('preserva o comportamento do convite de organização', async () => {
    const record = await invite('organization');
    expect(record.roleId).toBe(organizationTemplate);
    expect(await store.acceptById(record.id, alice)).toBe(true);
    expect(membershipRole('organization', alice).id).toBe(organizationTemplate);
    expect(query('SELECT id FROM workspace_members WHERE user_id = ?', alice)).toHaveLength(0);
  });

  it('não concede vínculos a outro destinatário, a conta não verificada ou com convite expirado', async () => {
    const record = await invite('page');
    expect(await store.acceptById(record.id, bob)).toBe(false);
    run('UPDATE users SET email_verified_at = NULL WHERE id = ?', alice);
    expect(await store.acceptById(record.id, alice)).toBe(false);
    run('UPDATE users SET email_verified_at = CURRENT_TIMESTAMP WHERE id = ?', alice);
    run("UPDATE access_invites SET expires_at = '2000-01-01T00:00:00Z' WHERE id = ?", record.id);
    expect(await store.acceptById(record.id, alice)).toBe(false);
    expect(query('SELECT id FROM page_collaborators')).toHaveLength(0);
    expect(query('SELECT id FROM workspace_members WHERE user_id <> ?', owner)).toHaveLength(0);
  });

  it('não deixa role órfã se a gravação do convite falha dentro da transação', async () => {
    const record = await invite('page');
    const count = query('SELECT id FROM page_roles').length;
    await expect(store.create({ id: ulid(), tokenHash: record.id.padEnd(64, '0'), tokenHint: 'hint', scope: 'page',
      scopeId: page, roleId: pageTemplate, recipientEmail: null, authorId: owner, expiresAt: null, acceptanceLimit: 1 })).rejects.toThrow();
    expect(query('SELECT id FROM page_roles')).toHaveLength(count);
  });
});
