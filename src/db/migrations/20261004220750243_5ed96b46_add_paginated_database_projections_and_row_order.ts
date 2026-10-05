// Frozen migration payload. Manual drafts require rqlite finalize migration.
export const migration = {
  "formatVersion": 1,
  "id": "20261004220750243_5ed96b46_add_paginated_database_projections_and_row_order",
  "description": "add paginated database projections and row order",
  "parentId": "20261002211726828_d11f844f_add_page_documents",
  "beforeSchemaHash": "9eff39dc36e932c921a296974f5e51f6de9d06521c74d82f944964794be6bfbf",
  "afterSchemaHash": "4a7407333e914cc13cec455ec8d45de890adf69a6e46d970960333cae337c58a",
  "checksum": "b5b580ee167037427bf7c8af153a17140ed69750e6637317267f795bc0479fa5",
  "requiredCapabilities": [
    "transactional-ddl"
  ],
  "risk": "safe",
  "state": "ready",
  "up": [
    "CREATE TABLE \"page_view_row_order\" (\"id\" TEXT PRIMARY KEY NOT NULL, \"created_at\" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, \"updated_at\" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, \"parent_id\" TEXT NOT NULL, \"view_id\" TEXT NOT NULL, \"row_id\" TEXT NOT NULL, \"rank\" TEXT NOT NULL, CHECK (length(id) = 26), FOREIGN KEY (\"parent_id\") REFERENCES \"pages\" (\"id\") ON DELETE CASCADE, FOREIGN KEY (\"row_id\") REFERENCES \"pages\" (\"id\") ON DELETE CASCADE)",
    "ALTER TABLE \"page_columns_values\" ADD COLUMN \"search_text\" TEXT DEFAULT NULL",
    "ALTER TABLE \"page_columns_values\" ADD COLUMN \"number_value\" REAL DEFAULT NULL",
    "ALTER TABLE \"page_columns_values\" ADD COLUMN \"select_option_id\" TEXT DEFAULT NULL",
    "ALTER TABLE \"page_columns_values\" ADD COLUMN \"checkbox_value\" INTEGER DEFAULT NULL",
    "ALTER TABLE \"page_columns_values\" ADD COLUMN \"date_start_ms\" INTEGER DEFAULT NULL",
    "ALTER TABLE \"page_columns_values\" ADD COLUMN \"date_end_ms\" INTEGER DEFAULT NULL",
    "ALTER TABLE \"page_columns_values\" ADD COLUMN \"value_kind\" TEXT NOT NULL DEFAULT 'missing'",
    "ALTER TABLE \"page_columns_values\" ADD COLUMN \"projection_version\" INTEGER NOT NULL DEFAULT 0",
    "CREATE INDEX \"idx_page_values_select\" ON \"page_columns_values\" (\"page_column_id\", \"select_option_id\", \"page_id\") WHERE select_option_id IS NOT NULL",
    "CREATE INDEX \"idx_page_values_number\" ON \"page_columns_values\" (\"page_column_id\", \"number_value\", \"page_id\") WHERE number_value IS NOT NULL",
    "CREATE INDEX \"idx_page_values_date_start\" ON \"page_columns_values\" (\"page_column_id\", \"date_start_ms\", \"page_id\") WHERE date_start_ms IS NOT NULL",
    "CREATE INDEX \"idx_page_values_date_end\" ON \"page_columns_values\" (\"page_column_id\", \"date_end_ms\", \"page_id\") WHERE date_end_ms IS NOT NULL",
    "CREATE INDEX \"idx_page_values_search\" ON \"page_columns_values\" (\"page_column_id\", \"search_text\", \"page_id\") WHERE search_text IS NOT NULL",
    "CREATE UNIQUE INDEX \"idx_page_view_row_order_row\" ON \"page_view_row_order\" (\"parent_id\", \"view_id\", \"row_id\")",
    "CREATE INDEX \"idx_page_view_row_order_cursor\" ON \"page_view_row_order\" (\"parent_id\", \"view_id\", \"rank\", \"row_id\")",
    "ALTER TABLE \"pages\" ADD COLUMN \"title_search\" TEXT DEFAULT NULL",
    "ALTER TABLE \"pages\" ADD COLUMN \"projection_version\" INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE \"pages\" ADD COLUMN \"dataset_revision\" INTEGER NOT NULL DEFAULT 0",
    "CREATE INDEX \"idx_pages_title_search\" ON \"pages\" (\"title_search\", \"id\") WHERE deleted_at IS NULL"
  ]
} as const;
