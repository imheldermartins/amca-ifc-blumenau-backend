// Frozen migration payload. Manual drafts require rqlite finalize migration.
export const migration = {
  "formatVersion": 1,
  "id": "20261025024712094_68ff1f26_add_page_favorites",
  "description": "add_page_favorites",
  "parentId": "20261023112039308_a7aeaa20_normalize_literal_users_updated_at",
  "beforeSchemaHash": "1ecc2875572a1ae26fd2ed0418fe394db1521d05d7527fd5a1233956228108bb",
  "afterSchemaHash": "ab976c81509f9b5d9913505883dd03a530df3a6b61b92c36d2951393c3a88aa8",
  "checksum": "346f6b11ca53e0ac6edee7c70e035c8d22faab0767010a3c7fb4df514c8ffb48",
  "requiredCapabilities": [
    "transactional-ddl"
  ],
  "risk": "safe",
  "state": "ready",
  "up": [
    "CREATE TABLE \"page_favorites\" (\"id\" TEXT PRIMARY KEY NOT NULL, \"created_at\" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, \"updated_at\" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, \"user_id\" TEXT NOT NULL, \"page_id\" TEXT NOT NULL, CHECK (length(id) = 26), FOREIGN KEY (\"user_id\") REFERENCES \"users\" (\"id\") ON DELETE CASCADE, FOREIGN KEY (\"page_id\") REFERENCES \"pages\" (\"id\") ON DELETE CASCADE)",
    "CREATE UNIQUE INDEX \"idx_page_favorites_user_page\" ON \"page_favorites\" (\"user_id\", \"page_id\")",
    "CREATE INDEX \"idx_page_favorites_user_created\" ON \"page_favorites\" (\"user_id\", \"created_at\", \"id\")"
  ]
} as const;
