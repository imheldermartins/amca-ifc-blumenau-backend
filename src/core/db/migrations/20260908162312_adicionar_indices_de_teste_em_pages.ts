import { type Migration } from '../migrator.js';

export const migration: Migration = {
  id: '20260908162312_adicionar_indices_de_teste_em_pages',
  up: [
    `CREATE INDEX IF NOT EXISTS idx_pages_owner_id
       ON pages (owner_id)`,

    `CREATE INDEX IF NOT EXISTS idx_page_edges_parent_id
       ON page_edges (parent_id)`,
  ],
  down: [
    `DROP INDEX IF EXISTS idx_page_edges_parent_id`,
    `DROP INDEX IF EXISTS idx_pages_owner_id`,
  ],
};
