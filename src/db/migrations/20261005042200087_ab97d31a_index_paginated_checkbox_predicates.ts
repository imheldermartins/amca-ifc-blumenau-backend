// Frozen migration payload. Manual drafts require rqlite finalize migration.
export const migration = {
  "formatVersion": 1,
  "id": "20261005042200087_ab97d31a_index_paginated_checkbox_predicates",
  "description": "index paginated checkbox predicates",
  "parentId": "20261004220750243_5ed96b46_add_paginated_database_projections_and_row_order",
  "beforeSchemaHash": "4a7407333e914cc13cec455ec8d45de890adf69a6e46d970960333cae337c58a",
  "afterSchemaHash": "ed9e78237012d5b871b48e9046e2eba89505bcd9a6e9af28c3322afe7d05fd10",
  "checksum": "10a5f08f212adec790e3c9f8f82db73458534de2d4182044260cfcaf0430fa93",
  "requiredCapabilities": [
    "transactional-ddl"
  ],
  "risk": "safe",
  "state": "ready",
  "up": [
    "CREATE INDEX \"idx_page_values_checkbox\" ON \"page_columns_values\" (\"page_column_id\", \"checkbox_value\", \"page_id\") WHERE checkbox_value IS NOT NULL"
  ]
} as const;
