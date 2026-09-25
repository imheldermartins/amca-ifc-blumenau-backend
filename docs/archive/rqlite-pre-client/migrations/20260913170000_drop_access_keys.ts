import type { Migration } from '../migrator.js';

/**
 * A entrada em organizações, workspaces e páginas ocorre somente por convite.
 * As tabelas de chaves antigas deixam de fazer parte do domínio.
 */
export const migration: Migration = {
  id: '20260913170000_drop_access_keys',
  up: [
    `DROP TABLE IF EXISTS workspace_access_key_links`,
    `DROP TABLE IF EXISTS workspace_access_keys`,
    `DROP TABLE IF EXISTS access_key`,
  ],
};
