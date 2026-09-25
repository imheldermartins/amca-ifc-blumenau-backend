import type { Migration } from '../migrator.js';

// Snapshot deliberado: todas as tabelas existentes que possuem updated_at.
const timestampedTables = [
  'access_invites',
  'account_verifications',
  'organization_members',
  'organization_pending_requests',
  'organization_roles',
  'organizations',
  'page_collaborators',
  'page_columns',
  'page_columns_values',
  'page_edges',
  'page_pending_requests',
  'page_roles',
  'pages',
  'users',
  'workspace_members',
  'workspace_pending_requests',
  'workspace_roles',
  'workspaces',
] as const;

const databaseNow = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/** Repara o legado que gravou a expressão SQL como texto, sem reescrever datas válidas. */
export const migration: Migration = {
  id: '20260920143000_repair_literal_updated_at',
  up: timestampedTables.map((table) =>
    `UPDATE ${table}
     SET updated_at = COALESCE(NULLIF(created_at, 'CURRENT_TIMESTAMP'), ${databaseNow})
     WHERE upper(trim(updated_at)) = 'CURRENT_TIMESTAMP'`,
  ),
};
