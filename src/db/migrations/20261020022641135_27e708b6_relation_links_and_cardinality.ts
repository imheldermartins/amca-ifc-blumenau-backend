export const migration = {
  "formatVersion": 1,
  "id": "20261020022641135_27e708b6_relation_links_and_cardinality",
  "description": "relation links and cardinality",
  "parentId": "20261019171931405_91dfff02_formula_and_extract_as_columns",
  "beforeSchemaHash": "e63e2a046624a2c90b165ba76a39d94245ba39a77cf5b0c186692439899a01ef",
  "afterSchemaHash": "406e3abcd7055589afb477bea40fe21e3ef400046ad304936085c97704818e98",
  "checksum": "ef4d0d88347e3cb6aad6dc7fa222574a51e07a53d80870d8e85dd5b4e65f27c6",
  "requiredCapabilities": [
    "transactional-ddl"
  ],
  "risk": "safe",
  "state": "ready",
  "up": [
    "CREATE TABLE \"page_relation_links\" (\"source_cell_id\" TEXT NOT NULL, \"target_page_id\" TEXT NOT NULL, \"position\" INTEGER NOT NULL, PRIMARY KEY (\"source_cell_id\", \"target_page_id\"), FOREIGN KEY (\"source_cell_id\") REFERENCES \"page_columns_values\" (\"id\") ON DELETE CASCADE, FOREIGN KEY (\"target_page_id\") REFERENCES \"pages\" (\"id\") ON DELETE CASCADE)",
    "CREATE INDEX \"idx_page_relation_links_target\" ON \"page_relation_links\" (\"target_page_id\", \"source_cell_id\")"
  ]
} as const;
