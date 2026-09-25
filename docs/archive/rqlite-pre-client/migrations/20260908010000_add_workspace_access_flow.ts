import { type Migration } from '../migrator.js';

export const migration: Migration = {
  id: '20260908010000_add_workspace_access_flow',
  up: [
    `CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY CHECK(length(id) = 26),
      name TEXT NOT NULL,
      data JSON NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `ALTER TABLE workspaces ADD COLUMN organization_id TEXT REFERENCES organizations(id)`,
    `ALTER TABLE workspaces ADD COLUMN icon TEXT NOT NULL DEFAULT 'lucide:boxes'`,
    `ALTER TABLE workspaces ADD COLUMN created_by_user_id TEXT REFERENCES users(id)`,
    `CREATE INDEX IF NOT EXISTS idx_workspaces_organization_id
      ON workspaces(organization_id)`,
    `CREATE TABLE IF NOT EXISTS workspace_members (
      id TEXT PRIMARY KEY CHECK(length(id) = 26),
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('superadmin', 'member')),
      page_root_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(page_root_id) REFERENCES pages(id),
      UNIQUE(workspace_id, user_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_workspace_members_user_id
      ON workspace_members(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace_role
      ON workspace_members(workspace_id, role)`,
    `CREATE TABLE IF NOT EXISTS workspace_access_keys (
      id TEXT PRIMARY KEY CHECK(length(id) = 26),
      key_hash TEXT NOT NULL UNIQUE CHECK(length(key_hash) = 64),
      key_hint TEXT NOT NULL,
      algorithm_version TEXT NOT NULL,
      issued_to_name TEXT NOT NULL,
      issued_to_email TEXT NOT NULL,
      purpose TEXT NOT NULL CHECK(purpose IN ('create', 'join')),
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      consumed_by_user_id TEXT,
      revoked_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(consumed_by_user_id) REFERENCES users(id)
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_access_keys_active_identity
      ON workspace_access_keys(lower(trim(issued_to_email)), purpose)
      WHERE consumed_at IS NULL AND revoked_at IS NULL`,
    `CREATE TABLE IF NOT EXISTS workspace_access_key_links (
      id TEXT PRIMARY KEY CHECK(length(id) = 26),
      access_key_id TEXT NOT NULL UNIQUE,
      workspace_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(access_key_id) REFERENCES workspace_access_keys(id),
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_workspace_access_key_links_workspace_id
      ON workspace_access_key_links(workspace_id)`,
    `UPDATE workspaces
      SET created_by_user_id = (
        SELECT pages.owner_id
        FROM pages
        WHERE pages.id = workspaces.id AND pages.deleted_at IS NULL
        LIMIT 1
      )
      WHERE created_by_user_id IS NULL`,
    `INSERT OR IGNORE INTO workspace_members (
      id, workspace_id, user_id, role, page_root_id
    )
      SELECT workspaces.id, workspaces.id, pages.owner_id, 'superadmin', pages.id
      FROM workspaces
      JOIN pages ON pages.id = workspaces.id AND pages.deleted_at IS NULL`,
  ],
  down: [
    `DROP TABLE IF EXISTS workspace_access_key_links`,
    `DROP INDEX IF EXISTS idx_workspace_access_keys_active_identity`,
    `DROP TABLE IF EXISTS workspace_access_keys`,
    `DROP TABLE IF EXISTS workspace_members`,
    `DROP TABLE IF EXISTS organizations`,
  ],
};
