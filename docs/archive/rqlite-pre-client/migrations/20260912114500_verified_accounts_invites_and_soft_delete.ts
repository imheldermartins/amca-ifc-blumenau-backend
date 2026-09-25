import type { Migration } from '../migrator.js';

// Snapshot deliberado: migrations não importam o catálogo vivo.
const permissions = {
  organization: JSON.stringify({
    read: ['view', 'workspaces', 'members', 'roles'],
    write: ['update', 'create', 'add_members', 'promote_members', 'create_org_roles', 'manage_workspaces'],
  }),
  workspace: JSON.stringify({
    read: ['view', 'members', 'roles'],
    write: ['update', 'create', 'add_members', 'promote_members', 'create_wk_roles', 'manage_pages'],
  }),
  page: JSON.stringify({
    read: ['view', 'subpages', 'members', 'roles'],
    write: ['update', 'create', 'edit_subpages', 'delete', 'add_members', 'promote_members', 'create_page_roles'],
  }),
};
const scopes = ['organization', 'workspace', 'page'] as const;
const resources = { organization: 'organizations', workspace: 'workspaces', page: 'pages' };
const members = { organization: 'organization_members', workspace: 'workspace_members', page: 'page_collaborators' };

export const migration: Migration = {
  id: '20260912114500_verified_accounts_invites_and_soft_delete',
  up: [
    `ALTER TABLE users ADD COLUMN email_verified_at TEXT`,
    // Contas anteriores já provaram sua identidade pelo fluxo então existente.
    `UPDATE users SET email_verified_at = COALESCE(created_at, CURRENT_TIMESTAMP)`,
    ...scopes.flatMap(scope => [
      `ALTER TABLE ${scope}_roles ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0,1))`,
      `ALTER TABLE ${scope}_roles ADD COLUMN system_key TEXT`,
      `ALTER TABLE ${scope}_roles ADD COLUMN deleted_at TEXT`,
      `INSERT INTO ${scope}_roles (id, ${scope}_id, name, roles, is_default, system_key)
        SELECT lower(resource.id), resource.id, 'Default', '${permissions[scope]}', 1, 'default'
        FROM ${resources[scope]} resource
        WHERE ${scope === 'page' ? 'resource.deleted_at IS NULL AND' : ''}
          NOT EXISTS (SELECT 1 FROM ${scope}_roles role WHERE role.${scope}_id = resource.id AND role.is_default = 1)`,
      `CREATE UNIQUE INDEX idx_${scope}_roles_default
        ON ${scope}_roles(${scope}_id) WHERE is_default = 1 AND deleted_at IS NULL`,
      `CREATE UNIQUE INDEX idx_${scope}_roles_system
        ON ${scope}_roles(${scope}_id, system_key) WHERE system_key IS NOT NULL AND deleted_at IS NULL`,
      `CREATE TABLE ${members[scope]}_lifecycle (
        id TEXT PRIMARY KEY CHECK(length(id) = 26),
        ${scope}_id TEXT NOT NULL REFERENCES ${resources[scope]}(id),
        user_id TEXT NOT NULL REFERENCES users(id),
        ${scope}_member_role_id TEXT,
        ${scope === 'workspace' ? 'page_root_id TEXT NOT NULL UNIQUE REFERENCES pages(id),' : ''}
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TEXT,
        FOREIGN KEY(${scope}_member_role_id, ${scope}_id) REFERENCES ${scope}_roles(id, ${scope}_id)
      )`,
      `INSERT INTO ${members[scope]}_lifecycle (
        id, ${scope}_id, user_id, ${scope}_member_role_id,
        ${scope === 'workspace' ? 'page_root_id,' : ''} created_at, updated_at
      ) SELECT id, ${scope}_id, user_id, ${scope}_member_role_id,
        ${scope === 'workspace' ? 'page_root_id,' : ''} created_at, updated_at FROM ${members[scope]}`,
      `DROP TABLE ${members[scope]}`,
      `ALTER TABLE ${members[scope]}_lifecycle RENAME TO ${members[scope]}`,
      `CREATE INDEX idx_${members[scope]}_user ON ${members[scope]}(user_id)`,
      `CREATE UNIQUE INDEX idx_${members[scope]}_active
        ON ${members[scope]}(${scope}_id, user_id) WHERE deleted_at IS NULL`,
      `CREATE TABLE ${scope}_pending_requests_lifecycle (
        id TEXT PRIMARY KEY CHECK(length(id) = 26),
        ${scope}_id TEXT NOT NULL REFERENCES ${resources[scope]}(id),
        requester_id TEXT NOT NULL REFERENCES users(id),
        notified_emails JSON NOT NULL DEFAULT '[]' CHECK(json_valid(notified_emails)),
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected','canceled','expired')),
        accepted_by TEXT REFERENCES users(id), decided_by TEXT REFERENCES users(id), decided_at TEXT,
        role_id TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, deleted_at TEXT,
        FOREIGN KEY(role_id, ${scope}_id) REFERENCES ${scope}_roles(id, ${scope}_id)
      )`,
      `INSERT INTO ${scope}_pending_requests_lifecycle
        (id, ${scope}_id, requester_id, notified_emails, status, accepted_by, decided_by, decided_at,
         role_id, created_at, updated_at)
        SELECT id, ${scope}_id, requester_id, notified_emails, status, accepted_by, decided_by, decided_at,
          role_id, created_at, updated_at FROM ${scope}_pending_requests`,
      `DROP TABLE ${scope}_pending_requests`,
      `ALTER TABLE ${scope}_pending_requests_lifecycle RENAME TO ${scope}_pending_requests`,
      `CREATE UNIQUE INDEX idx_${scope}_pending_requests_open
        ON ${scope}_pending_requests(${scope}_id, requester_id)
        WHERE status = 'pending' AND deleted_at IS NULL`,
    ]),
    `INSERT INTO organization_roles (id, organization_id, name, roles, is_default, system_key)
      SELECT upper(o.id), o.id, 'Convidado de workspace',
        '{"read":["view"],"write":[]}', 0, 'workspace_guest'
      FROM organizations o WHERE NOT EXISTS (
        SELECT 1 FROM organization_roles r WHERE r.organization_id = o.id
          AND r.system_key = 'workspace_guest' AND r.deleted_at IS NULL)`,
    `CREATE TABLE access_invites (
      id TEXT PRIMARY KEY CHECK(length(id) = 26),
      token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash) = 64),
      token_hint TEXT NOT NULL,
      scope_type TEXT NOT NULL CHECK(scope_type IN ('organization','workspace','page')),
      scope_id TEXT NOT NULL,
      role_id TEXT,
      recipient_email TEXT,
      author_id TEXT NOT NULL REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected','canceled','expired')),
      expires_at TEXT,
      acceptance_limit INTEGER CHECK(acceptance_limit IS NULL OR acceptance_limit > 0),
      acceptance_count INTEGER NOT NULL DEFAULT 0 CHECK(acceptance_count >= 0),
      notified_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT
    )`,
    `CREATE INDEX idx_access_invites_scope ON access_invites(scope_type, scope_id, created_at)`,
    `CREATE INDEX idx_access_invites_recipient ON access_invites(lower(trim(recipient_email)))`,
    `CREATE TABLE access_invite_acceptances (
      id TEXT PRIMARY KEY CHECK(length(id) = 26),
      invite_id TEXT NOT NULL REFERENCES access_invites(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      accepted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(invite_id, user_id)
    )`,
    `CREATE TABLE account_verifications (
      id TEXT PRIMARY KEY CHECK(length(id) = 26),
      user_id TEXT NOT NULL REFERENCES users(id),
      token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash) = 64),
      token_hint TEXT NOT NULL,
      invite_id TEXT REFERENCES access_invites(id),
      context JSON NOT NULL DEFAULT '{}' CHECK(json_valid(context)),
      expires_at TEXT NOT NULL,
      last_sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      consumed_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT
    )`,
    `CREATE UNIQUE INDEX idx_account_verifications_active
      ON account_verifications(user_id) WHERE consumed_at IS NULL AND deleted_at IS NULL`,
  ],
  // Reverter descartaria histórico de verificação, convites e remoções.
};
