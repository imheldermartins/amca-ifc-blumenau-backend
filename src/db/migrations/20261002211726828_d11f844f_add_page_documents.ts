// Frozen migration payload. Manual drafts require rqlite finalize migration.
export const migration = {
  "formatVersion": 1,
  "id": "20261002211726828_d11f844f_add_page_documents",
  "description": "add page documents",
  "parentId": "20261002205813488_79c27e84_add_form_publications_and_submissions",
  "beforeSchemaHash": "a5dabbc178bb3b81296e5be0eef9b4b9ff3ab9d27c3cf1b566ffde0b2deaf705",
  "afterSchemaHash": "9eff39dc36e932c921a296974f5e51f6de9d06521c74d82f944964794be6bfbf",
  "checksum": "6ceaeaf3042992a05fd26e71bc3f127cc3a71a2f533698ce2822d53a4185ff7c",
  "requiredCapabilities": [
    "transactional-ddl"
  ],
  "risk": "safe",
  "state": "ready",
  "up": [
    "CREATE TABLE \"page_documents\" (\"id\" TEXT PRIMARY KEY NOT NULL, \"created_at\" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, \"updated_at\" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, \"page_id\" TEXT NOT NULL, \"content\" TEXT NOT NULL, \"revision\" REAL NOT NULL DEFAULT 1, UNIQUE (\"page_id\"), CHECK (length(id) = 26), FOREIGN KEY (\"page_id\") REFERENCES \"pages\" (\"id\"))"
  ]
} as const;
