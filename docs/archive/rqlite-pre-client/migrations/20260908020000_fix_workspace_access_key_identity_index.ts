import { type Migration } from '../migrator.js';

export const migration: Migration = {
  id: '20260908020000_fix_workspace_access_key_identity_index',
  up: [
    // Uma chave expirada não pode bloquear convites futuros e a mesma pessoa
    // pode receber convites simultâneos para workspaces diferentes. A
    // unicidade real da credencial continua em key_hash; este índice serve só
    // às consultas/auditoria por identidade e estado.
    `DROP INDEX IF EXISTS idx_workspace_access_keys_active_identity`,
    `CREATE INDEX IF NOT EXISTS idx_workspace_access_keys_identity_state
      ON workspace_access_keys(
        lower(trim(issued_to_email)), purpose, consumed_at, revoked_at, expires_at
      )`,
  ],
  down: [
    `DROP INDEX IF EXISTS idx_workspace_access_keys_identity_state`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_access_keys_active_identity
      ON workspace_access_keys(lower(trim(issued_to_email)), purpose)
      WHERE consumed_at IS NULL AND revoked_at IS NULL`,
  ],
};
