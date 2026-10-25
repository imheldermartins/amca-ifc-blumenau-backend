export const migration = {
  "formatVersion": 1,
  "id": "20261023111924265_4ce7353b_repair_recurring_users_updated_at",
  "description": "repair recurring users updated at",
  "parentId": "20261020023101397_c32e8cfa_relation_snapshot_invariants",
  "beforeSchemaHash": "ab84e92d6515409c49d8de3339ad63e7488268110593cdb1522598862b4a3670",
  "afterSchemaHash": "ab84e92d6515409c49d8de3339ad63e7488268110593cdb1522598862b4a3670",
  "checksum": "03b36c20f945643ee7bbb96c36ca00ba75e49b1ae8fef112929477dd15372f5a",
  "requiredCapabilities": [
    "transactional-ddl"
  ],
  "risk": "manual",
  "state": "ready",
  "up": [
    "UPDATE users SET updated_at = COALESCE(NULLIF(created_at, 'CURRENT_TIMESTAMP'), datetime('now')) WHERE upper(trim(updated_at)) = 'CURRENT_TIMESTAMP'"
  ],
  "dataOnly": true
} as const;
