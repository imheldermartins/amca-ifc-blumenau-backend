// Frozen migration payload. Manual drafts require rqlite finalize migration.
export const migration = {
  "formatVersion": 1,
  "id": "20260928231611832_eef4196a_add_pinned_schedule_pages",
  "description": "add pinned schedule pages",
  "parentId": "20260926211058243_9a36cd7b_repair_literal_updated_at",
  "beforeSchemaHash": "33a97fb64f1d47b7b9d9e58d654f8ca272b32d44105c3c034ada025e61bd5483",
  "afterSchemaHash": "a3d486f3c0a1c307ee615fa731caca77d5119b596b1546801769b9619bfbdd7a",
  "checksum": "b0f8666462f18331b520cf998d9816591a3f99b89a67b280b755a8fd83072bf0",
  "requiredCapabilities": [
    "transactional-ddl"
  ],
  "risk": "safe",
  "state": "ready",
  "up": [
    "CREATE TABLE \"pinned_schedule_pages\" (\"id\" TEXT PRIMARY KEY NOT NULL, \"created_at\" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, \"updated_at\" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, \"workspace_id\" TEXT NOT NULL, \"page_id\" TEXT NOT NULL, \"pinned_by_user_id\" TEXT NOT NULL, \"date_column_id\" TEXT NOT NULL, \"color_column_id\" TEXT DEFAULT NULL, CHECK (length(id) = 26), FOREIGN KEY (\"workspace_id\") REFERENCES \"workspaces\" (\"id\"), FOREIGN KEY (\"page_id\") REFERENCES \"pages\" (\"id\"), FOREIGN KEY (\"pinned_by_user_id\") REFERENCES \"users\" (\"id\"), FOREIGN KEY (\"date_column_id\") REFERENCES \"page_columns\" (\"id\"), FOREIGN KEY (\"color_column_id\") REFERENCES \"page_columns\" (\"id\"))",
    "CREATE INDEX \"idx_pinned_schedule_pages_workspace_user\" ON \"pinned_schedule_pages\" (\"workspace_id\", \"pinned_by_user_id\")",
    "CREATE UNIQUE INDEX \"idx_pinned_schedule_pages_unique\" ON \"pinned_schedule_pages\" (\"workspace_id\", \"pinned_by_user_id\", \"page_id\")"
  ]
} as const;
