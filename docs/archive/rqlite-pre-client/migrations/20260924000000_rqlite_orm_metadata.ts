import type { Migration } from '../migrator.js';

// Frozen infrastructure v1; do not import the package's current bootstrap SQL.
export const migration: Migration = {
  id: '20260924000000_rqlite_orm_metadata',
  up: [
    `CREATE TABLE _orm_state (singleton INTEGER PRIMARY KEY CHECK(singleton=1), head TEXT, schema_hash TEXT NOT NULL, catalog TEXT NOT NULL)`,
    `CREATE TABLE _orm_history (id TEXT PRIMARY KEY REFERENCES _migrations(id), parent_id TEXT, checksum TEXT NOT NULL, schema_hash TEXT NOT NULL)`,
    `CREATE TABLE _orm_assert (value INTEGER NOT NULL CHECK(value=1))`,
  ],
};
