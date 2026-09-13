import { type Migration } from '../migrator.js';

/**
 * A criação de organizações passou a depender somente da conta autenticada e
 * do e-mail validado. As chaves continuam existindo apenas para os fluxos
 * legados de criação e entrada em workspaces.
 */
export const migration: Migration = {
  id: '20260912130000_remove_organization_access_keys',
  up: [
    `CREATE TABLE access_key_workspace_only (
      id TEXT PRIMARY KEY CHECK(length(id) = 26),
      key_hash TEXT NOT NULL UNIQUE CHECK(length(key_hash) = 64),
      key_hint TEXT NOT NULL,
      algorithm_version TEXT NOT NULL,
      issued_to_name TEXT NOT NULL,
      issued_to_email TEXT NOT NULL,
      purpose TEXT NOT NULL CHECK(purpose IN ('create', 'join')),
      workspace_id TEXT REFERENCES workspaces(id),
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      consumed_by_user_id TEXT REFERENCES users(id),
      consumed_as_name TEXT,
      consumed_as_email TEXT,
      revoked_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `INSERT INTO access_key_workspace_only (
      id, key_hash, key_hint, algorithm_version, issued_to_name, issued_to_email,
      purpose, workspace_id, expires_at, consumed_at, consumed_by_user_id,
      consumed_as_name, consumed_as_email, revoked_at, created_at, updated_at
    ) SELECT id, key_hash, key_hint, algorithm_version, issued_to_name,
      issued_to_email, purpose, workspace_id, expires_at, consumed_at,
      consumed_by_user_id, consumed_as_name, consumed_as_email, revoked_at,
      created_at, updated_at FROM access_key WHERE purpose IN ('create', 'join')`,
    `DROP TABLE access_key`,
    `ALTER TABLE access_key_workspace_only RENAME TO access_key`,
    `CREATE INDEX idx_access_key_recipient
      ON access_key(lower(trim(issued_to_email)), purpose)`,
    `CREATE INDEX idx_access_key_workspace ON access_key(workspace_id)`,
  ],
};
