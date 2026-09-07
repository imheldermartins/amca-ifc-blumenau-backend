import { type Migration } from '../migrator.js';

export const migration: Migration = {
  id: '20260907010000_add_soft_delete_to_pages_and_columns',
  up: [
    `ALTER TABLE pages ADD COLUMN deleted_at TEXT DEFAULT NULL`,
    `ALTER TABLE page_columns ADD COLUMN deleted_at TEXT DEFAULT NULL`,
    `CREATE INDEX idx_pages_deleted_at ON pages (deleted_at)`,
    `CREATE INDEX idx_page_columns_parent_deleted_at ON page_columns (parent_id, deleted_at)`,
  ],
  down: [
    `DROP INDEX IF EXISTS idx_page_columns_parent_deleted_at`,
    `DROP INDEX IF EXISTS idx_pages_deleted_at`,
    `ALTER TABLE page_columns DROP COLUMN deleted_at`,
    `ALTER TABLE pages DROP COLUMN deleted_at`,
  ],
};
