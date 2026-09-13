import { type Migration } from '../migrator.js';

// Snapshot da política legada; não importar o catálogo vivo em uma migration.
const rights = {
  organization: { read: ['view', 'workspaces', 'members', 'roles'], write: ['update', 'create', 'add_members', 'promote_members', 'create_org_roles', 'manage_workspaces'] },
  workspace: { read: ['view', 'members', 'roles'], write: ['update', 'create', 'add_members', 'promote_members', 'create_wk_roles', 'manage_pages'] },
  page: { read: ['view', 'subpages', 'members'], write: ['update', 'create', 'edit_subpages'] },
};
const scopes = ['organization', 'workspace', 'page'] as const;
const resources = { organization: 'organizations', workspace: 'workspaces', page: 'pages' };
const memberships = { organization: 'organization_members', workspace: 'workspace_members', page: 'page_collaborators' };

export const migration: Migration = {
  id: '20260912041438_scoped_roles_access_keys_and_membership_requests',
  up: [
    `ALTER TABLE organizations ADD COLUMN owner_id TEXT REFERENCES users(id)`,
    `UPDATE organizations SET owner_id = (
      SELECT om.user_id FROM organization_members om
      WHERE om.organization_id = organizations.id
      ORDER BY om.created_at, om.id LIMIT 1
    )`,
    ...scopes.flatMap((scope) => [
      `CREATE TABLE ${scope}_roles (
        id TEXT PRIMARY KEY CHECK(length(id) = 26),
        ${scope}_id TEXT NOT NULL REFERENCES ${resources[scope]}(id),
        name TEXT NOT NULL,
        roles JSON NOT NULL CHECK(json_valid(roles)),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(id, ${scope}_id)
      )`,
      `CREATE INDEX idx_${scope}_roles_scope ON ${scope}_roles(${scope}_id)`,
      `INSERT INTO ${scope}_roles (id, ${scope}_id, name, roles, created_at, updated_at)
        SELECT m.id, m.${scope}_id, 'Acesso importado',
          ${scope === 'page' ? `'${JSON.stringify(rights.page)}'` : `CASE WHEN m.role = 'superadmin'
            THEN '${JSON.stringify(rights[scope])}' ELSE '{"read":["view"],"write":[]}' END`},
          m.created_at, m.updated_at FROM ${memberships[scope]} m`,
      `CREATE TABLE ${memberships[scope]}_scoped (
        id TEXT PRIMARY KEY CHECK(length(id) = 26),
        ${scope}_id TEXT NOT NULL REFERENCES ${resources[scope]}(id),
        user_id TEXT NOT NULL REFERENCES users(id),
        ${scope}_member_role_id TEXT,
        ${scope === 'workspace' ? 'page_root_id TEXT NOT NULL UNIQUE REFERENCES pages(id),' : ''}
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(${scope}_id, user_id),
        FOREIGN KEY(${scope}_member_role_id, ${scope}_id) REFERENCES ${scope}_roles(id, ${scope}_id)
      )`,
      `INSERT INTO ${memberships[scope]}_scoped (
        id, ${scope}_id, user_id, ${scope}_member_role_id,
        ${scope === 'workspace' ? 'page_root_id,' : ''} created_at, updated_at
      ) SELECT id, ${scope}_id, user_id, id,
        ${scope === 'workspace' ? 'page_root_id,' : ''} created_at, updated_at FROM ${memberships[scope]}`,
      `DROP TABLE ${memberships[scope]}`,
      `ALTER TABLE ${memberships[scope]}_scoped RENAME TO ${memberships[scope]}`,
      `CREATE INDEX idx_${memberships[scope]}_user ON ${memberships[scope]}(user_id)`,
      `CREATE TABLE ${scope}_pending_requests (
        id TEXT PRIMARY KEY CHECK(length(id) = 26),
        ${scope}_id TEXT NOT NULL REFERENCES ${resources[scope]}(id),
        requester_id TEXT NOT NULL REFERENCES users(id),
        notified_emails JSON NOT NULL DEFAULT '[]' CHECK(json_valid(notified_emails)),
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'rejected')),
        accepted_by TEXT REFERENCES users(id),
        decided_by TEXT REFERENCES users(id),
        decided_at TEXT,
        role_id TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(role_id, ${scope}_id) REFERENCES ${scope}_roles(id, ${scope}_id)
      )`,
      `CREATE UNIQUE INDEX idx_${scope}_pending_requests_open
        ON ${scope}_pending_requests(${scope}_id, requester_id) WHERE status = 'pending'`,
    ]),
    `CREATE TABLE access_key (
      id TEXT PRIMARY KEY CHECK(length(id) = 26),
      key_hash TEXT NOT NULL UNIQUE CHECK(length(key_hash) = 64),
      key_hint TEXT NOT NULL, algorithm_version TEXT NOT NULL,
      issued_to_name TEXT NOT NULL, issued_to_email TEXT NOT NULL,
      purpose TEXT NOT NULL CHECK(purpose IN ('create', 'join', 'create_organization')),
      workspace_id TEXT REFERENCES workspaces(id),
      organization_id TEXT REFERENCES organizations(id),
      expires_at TEXT NOT NULL, consumed_at TEXT,
      consumed_by_user_id TEXT REFERENCES users(id),
      consumed_as_name TEXT, consumed_as_email TEXT, revoked_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `INSERT INTO access_key SELECT k.id, k.key_hash, k.key_hint, k.algorithm_version,
      k.issued_to_name, k.issued_to_email, k.purpose, l.workspace_id, NULL,
      k.expires_at, k.consumed_at, k.consumed_by_user_id, k.consumed_as_name,
      k.consumed_as_email, k.revoked_at, k.created_at, k.updated_at
      FROM workspace_access_keys k LEFT JOIN workspace_access_key_links l ON l.access_key_id = k.id`,
    `DROP TABLE workspace_access_key_links`,
    `DROP TABLE workspace_access_keys`,
    `CREATE INDEX idx_access_key_recipient ON access_key(lower(trim(issued_to_email)), purpose)`,
    `CREATE INDEX idx_access_key_workspace ON access_key(workspace_id)`,
  ],
  // A volta aos enums descartaria templates e auditoria; rollback exige restauração do backup.
};
