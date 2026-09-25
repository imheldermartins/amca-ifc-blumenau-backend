import type { Migration } from '../migrator.js';

/** A atividade agora deriva de pages.updated_at na árvore, sem relógio paralelo. */
export const migration: Migration = {
  id: '20260914170000_drop_page_database_updated_at',
  up: ['ALTER TABLE pages DROP COLUMN database_updated_at'],
  down: ['ALTER TABLE pages ADD COLUMN database_updated_at TEXT DEFAULT NULL'],
};
