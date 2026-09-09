import { type Migration } from '../migrator.js';

export const migration: Migration = {
  id: '20260908200757_add_organization_memberships',
  up: [
    `CREATE TABLE IF NOT EXISTS organization_members (
      id TEXT PRIMARY KEY CHECK(length(id) = 26),
      organization_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('superadmin', 'member')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(organization_id) REFERENCES organizations(id),
      FOREIGN KEY(user_id) REFERENCES users(id),
      UNIQUE(organization_id, user_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_organization_members_user_id
      ON organization_members(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_organization_members_organization_role
      ON organization_members(organization_id, role)`,
    `INSERT OR IGNORE INTO organization_members (
      id, organization_id, user_id, role
    )
      SELECT MIN(workspaces.id), workspaces.organization_id,
        workspaces.created_by_user_id, 'superadmin'
      FROM workspaces
      WHERE workspaces.organization_id IS NOT NULL
        AND workspaces.created_by_user_id IS NOT NULL
      GROUP BY workspaces.organization_id, workspaces.created_by_user_id`,
  ],
  down: [
    `DROP INDEX IF EXISTS idx_organization_members_organization_role`,
    `DROP INDEX IF EXISTS idx_organization_members_user_id`,
    `DROP TABLE IF EXISTS organization_members`,
  ],
};
