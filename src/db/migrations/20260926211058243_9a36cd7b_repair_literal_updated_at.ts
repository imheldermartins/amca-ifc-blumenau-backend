export const migration = {
  "formatVersion": 1,
  "id": "20260926211058243_9a36cd7b_repair_literal_updated_at",
  "description": "repair literal updated at",
  "parentId": "20260924235507356_619638ca_initial_schema_from_decorators",
  "beforeSchemaHash": "33a97fb64f1d47b7b9d9e58d654f8ca272b32d44105c3c034ada025e61bd5483",
  "afterSchemaHash": "33a97fb64f1d47b7b9d9e58d654f8ca272b32d44105c3c034ada025e61bd5483",
  "checksum": "1a469ec64ff3353d2c2d72f837333044ffa5f232c0bb88559435e7a238fa3ad8",
  "requiredCapabilities": [
    "transactional-ddl"
  ],
  "risk": "manual",
  "state": "ready",
  "up": [
    "UPDATE access_invites SET updated_at = COALESCE(NULLIF(created_at, 'CURRENT_TIMESTAMP'), datetime('now')) WHERE upper(trim(updated_at)) = 'CURRENT_TIMESTAMP'",
    "UPDATE account_verifications SET updated_at = COALESCE(NULLIF(created_at, 'CURRENT_TIMESTAMP'), datetime('now')) WHERE upper(trim(updated_at)) = 'CURRENT_TIMESTAMP'",
    "UPDATE organization_members SET updated_at = COALESCE(NULLIF(created_at, 'CURRENT_TIMESTAMP'), datetime('now')) WHERE upper(trim(updated_at)) = 'CURRENT_TIMESTAMP'",
    "UPDATE organization_pending_requests SET updated_at = COALESCE(NULLIF(created_at, 'CURRENT_TIMESTAMP'), datetime('now')) WHERE upper(trim(updated_at)) = 'CURRENT_TIMESTAMP'",
    "UPDATE organization_roles SET updated_at = COALESCE(NULLIF(created_at, 'CURRENT_TIMESTAMP'), datetime('now')) WHERE upper(trim(updated_at)) = 'CURRENT_TIMESTAMP'",
    "UPDATE organizations SET updated_at = COALESCE(NULLIF(created_at, 'CURRENT_TIMESTAMP'), datetime('now')) WHERE upper(trim(updated_at)) = 'CURRENT_TIMESTAMP'",
    "UPDATE page_collaborators SET updated_at = COALESCE(NULLIF(created_at, 'CURRENT_TIMESTAMP'), datetime('now')) WHERE upper(trim(updated_at)) = 'CURRENT_TIMESTAMP'",
    "UPDATE page_columns SET updated_at = COALESCE(NULLIF(created_at, 'CURRENT_TIMESTAMP'), datetime('now')) WHERE upper(trim(updated_at)) = 'CURRENT_TIMESTAMP'",
    "UPDATE page_columns_values SET updated_at = COALESCE(NULLIF(created_at, 'CURRENT_TIMESTAMP'), datetime('now')) WHERE upper(trim(updated_at)) = 'CURRENT_TIMESTAMP'",
    "UPDATE page_edges SET updated_at = COALESCE(NULLIF(created_at, 'CURRENT_TIMESTAMP'), datetime('now')) WHERE upper(trim(updated_at)) = 'CURRENT_TIMESTAMP'",
    "UPDATE page_pending_requests SET updated_at = COALESCE(NULLIF(created_at, 'CURRENT_TIMESTAMP'), datetime('now')) WHERE upper(trim(updated_at)) = 'CURRENT_TIMESTAMP'",
    "UPDATE page_roles SET updated_at = COALESCE(NULLIF(created_at, 'CURRENT_TIMESTAMP'), datetime('now')) WHERE upper(trim(updated_at)) = 'CURRENT_TIMESTAMP'",
    "UPDATE pages SET updated_at = COALESCE(NULLIF(created_at, 'CURRENT_TIMESTAMP'), datetime('now')) WHERE upper(trim(updated_at)) = 'CURRENT_TIMESTAMP'",
    "UPDATE users SET updated_at = COALESCE(NULLIF(created_at, 'CURRENT_TIMESTAMP'), datetime('now')) WHERE upper(trim(updated_at)) = 'CURRENT_TIMESTAMP'",
    "UPDATE workspace_members SET updated_at = COALESCE(NULLIF(created_at, 'CURRENT_TIMESTAMP'), datetime('now')) WHERE upper(trim(updated_at)) = 'CURRENT_TIMESTAMP'",
    "UPDATE workspace_pending_requests SET updated_at = COALESCE(NULLIF(created_at, 'CURRENT_TIMESTAMP'), datetime('now')) WHERE upper(trim(updated_at)) = 'CURRENT_TIMESTAMP'",
    "UPDATE workspace_roles SET updated_at = COALESCE(NULLIF(created_at, 'CURRENT_TIMESTAMP'), datetime('now')) WHERE upper(trim(updated_at)) = 'CURRENT_TIMESTAMP'",
    "UPDATE workspaces SET updated_at = COALESCE(NULLIF(created_at, 'CURRENT_TIMESTAMP'), datetime('now')) WHERE upper(trim(updated_at)) = 'CURRENT_TIMESTAMP'"
  ],
  "dataOnly": true
} as const;
