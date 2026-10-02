// Frozen migration payload. Manual drafts require rqlite finalize migration.
export const migration = {
  "formatVersion": 1,
  "id": "20260930002722501_55bb4d04_add_schedule_notifications",
  "description": "add schedule notifications",
  "parentId": "20260928231611832_eef4196a_add_pinned_schedule_pages",
  "beforeSchemaHash": "a3d486f3c0a1c307ee615fa731caca77d5119b596b1546801769b9619bfbdd7a",
  "afterSchemaHash": "041fd101337648d1474234b5a96af2b7ccb98492c0869c653f9dba97634380c9",
  "checksum": "eeaa56640e303ecea4e32e9bbca63006e96db217c14f5dc2c04af51fcedc74f4",
  "requiredCapabilities": [
    "transactional-ddl"
  ],
  "risk": "safe",
  "state": "ready",
  "up": [
    "CREATE TABLE \"notifications\" (\"id\" TEXT PRIMARY KEY NOT NULL, \"created_at\" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, \"updated_at\" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, \"workspace_id\" TEXT NOT NULL, \"recipient_user_id\" TEXT NOT NULL, \"actor_user_id\" TEXT DEFAULT NULL, \"type\" TEXT NOT NULL, \"resource_type\" TEXT NOT NULL, \"resource_id\" TEXT NOT NULL, \"data\" TEXT NOT NULL DEFAULT '{}', \"dedupe_key\" TEXT NOT NULL, \"read_at\" TEXT DEFAULT NULL, CHECK (length(id) = 26), FOREIGN KEY (\"workspace_id\") REFERENCES \"workspaces\" (\"id\"), FOREIGN KEY (\"recipient_user_id\") REFERENCES \"users\" (\"id\"), FOREIGN KEY (\"actor_user_id\") REFERENCES \"users\" (\"id\"))",
    "CREATE TABLE \"notification_deliveries\" (\"id\" TEXT PRIMARY KEY NOT NULL, \"created_at\" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, \"updated_at\" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, \"notification_id\" TEXT NOT NULL, \"channel\" TEXT NOT NULL DEFAULT 'email', \"status\" TEXT NOT NULL DEFAULT 'pending', \"attempts\" INTEGER NOT NULL DEFAULT 0, \"payload\" TEXT NOT NULL DEFAULT '{}', \"next_attempt_at\" TEXT DEFAULT NULL, \"locked_at\" TEXT DEFAULT NULL, \"sent_at\" TEXT DEFAULT NULL, \"provider_message_id\" TEXT DEFAULT NULL, \"last_error\" TEXT DEFAULT NULL, CHECK (length(id) = 26), CHECK (channel IN ('email')), CHECK (status IN ('pending','processing','sent','failed')), CHECK (attempts >= 0), FOREIGN KEY (\"notification_id\") REFERENCES \"notifications\" (\"id\"))",
    "CREATE TABLE \"schedule_pin_requests\" (\"id\" TEXT PRIMARY KEY NOT NULL, \"created_at\" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, \"updated_at\" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, \"workspace_id\" TEXT NOT NULL, \"page_id\" TEXT NOT NULL, \"requested_by_user_id\" TEXT NOT NULL, \"recipient_user_id\" TEXT NOT NULL, \"date_column_id\" TEXT NOT NULL, \"color_column_id\" TEXT DEFAULT NULL, \"status\" TEXT NOT NULL DEFAULT 'pending', \"decided_at\" TEXT DEFAULT NULL, CHECK (length(id) = 26), CHECK (status IN ('pending','accepted','declined','canceled')), FOREIGN KEY (\"workspace_id\") REFERENCES \"workspaces\" (\"id\"), FOREIGN KEY (\"page_id\") REFERENCES \"pages\" (\"id\"), FOREIGN KEY (\"requested_by_user_id\") REFERENCES \"users\" (\"id\"), FOREIGN KEY (\"recipient_user_id\") REFERENCES \"users\" (\"id\"), FOREIGN KEY (\"date_column_id\") REFERENCES \"page_columns\" (\"id\"), FOREIGN KEY (\"color_column_id\") REFERENCES \"page_columns\" (\"id\"))",
    "CREATE UNIQUE INDEX \"idx_notification_deliveries_notification_channel\" ON \"notification_deliveries\" (\"notification_id\", \"channel\")",
    "CREATE INDEX \"idx_notification_deliveries_due\" ON \"notification_deliveries\" (\"status\", \"next_attempt_at\")",
    "CREATE INDEX \"idx_notifications_recipient_workspace_created\" ON \"notifications\" (\"recipient_user_id\", \"workspace_id\", \"created_at\")",
    "CREATE UNIQUE INDEX \"idx_notifications_dedupe_key\" ON \"notifications\" (\"dedupe_key\")",
    "CREATE INDEX \"idx_schedule_pin_requests_recipient_status\" ON \"schedule_pin_requests\" (\"recipient_user_id\", \"status\", \"created_at\")",
    "CREATE UNIQUE INDEX \"idx_schedule_pin_requests_pending_unique\" ON \"schedule_pin_requests\" (\"workspace_id\", \"recipient_user_id\", \"page_id\") WHERE status = 'pending'"
  ]
} as const;
