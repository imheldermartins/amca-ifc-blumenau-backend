import type { Migration } from '../migrator.js';

export const migration: Migration = {
  id: '20260913190000_add_page_database_updated_at',
  up: [
    `ALTER TABLE pages ADD COLUMN database_updated_at TEXT DEFAULT NULL`,
  ],
  down: [
    `ALTER TABLE pages DROP COLUMN database_updated_at`,
  ],
};
