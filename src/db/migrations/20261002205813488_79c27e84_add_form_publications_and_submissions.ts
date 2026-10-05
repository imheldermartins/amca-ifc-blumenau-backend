// Frozen migration payload. Manual drafts require rqlite finalize migration.
export const migration = {
  "formatVersion": 1,
  "id": "20261002205813488_79c27e84_add_form_publications_and_submissions",
  "description": "add form publications and submissions",
  "parentId": "20261001052915696_6534e769_allow_external_notification_recipients",
  "beforeSchemaHash": "bc270b3c0722a62acf941bcd1924ec23c2b5a6d12ce1855c40279b46d7c5ce7c",
  "afterSchemaHash": "a5dabbc178bb3b81296e5be0eef9b4b9ff3ab9d27c3cf1b566ffde0b2deaf705",
  "checksum": "8c6aff1b30703ffa592afbbd18b8e84789d0204c370f6b9785e88ba45527d9e9",
  "requiredCapabilities": [
    "transactional-ddl"
  ],
  "risk": "safe",
  "state": "ready",
  "up": [
    "CREATE TABLE \"page_form_publications\" (\"id\" TEXT PRIMARY KEY NOT NULL, \"created_at\" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, \"updated_at\" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, \"page_id\" TEXT NOT NULL, \"view_id\" TEXT NOT NULL, \"created_by_user_id\" TEXT NOT NULL, \"submit_token_hash\" TEXT NOT NULL, \"submit_token_hint\" TEXT NOT NULL, \"review_token_hash\" TEXT NOT NULL, \"review_token_hint\" TEXT NOT NULL, \"expires_at\" TEXT DEFAULT NULL, \"revoked_at\" TEXT DEFAULT NULL, UNIQUE (\"page_id\", \"view_id\"), UNIQUE (\"submit_token_hash\"), UNIQUE (\"review_token_hash\"), CHECK (length(id) = 26), CHECK (length(submit_token_hash) = 64), CHECK (length(review_token_hash) = 64), FOREIGN KEY (\"page_id\") REFERENCES \"pages\" (\"id\"), FOREIGN KEY (\"created_by_user_id\") REFERENCES \"users\" (\"id\"))",
    "CREATE TABLE \"page_form_submissions\" (\"id\" TEXT PRIMARY KEY NOT NULL, \"created_at\" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, \"updated_at\" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, \"publication_id\" TEXT NOT NULL, \"response_page_id\" TEXT NOT NULL, \"client_request_id\" TEXT NOT NULL, \"payload_hash\" TEXT NOT NULL, \"flow_execution_id\" TEXT NOT NULL, UNIQUE (\"publication_id\", \"client_request_id\"), UNIQUE (\"response_page_id\"), CHECK (length(id) = 26), CHECK (length(payload_hash) = 64), FOREIGN KEY (\"publication_id\") REFERENCES \"page_form_publications\" (\"id\"), FOREIGN KEY (\"response_page_id\") REFERENCES \"pages\" (\"id\"))",
    "CREATE INDEX \"idx_page_form_publications_page_view\" ON \"page_form_publications\" (\"page_id\", \"view_id\")",
    "CREATE INDEX \"idx_page_form_submissions_publication_created\" ON \"page_form_submissions\" (\"publication_id\", \"created_at\", \"id\")"
  ]
} as const;
