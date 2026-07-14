import { type Migration } from '../migrator.js';

export const migration: Migration = {
  id: '20260713221509_rename_page_columns_root_to_parent',
  up: [
    /**
     * Renomeia page_columns.page_root_id -> parent_id, alinhando à convenção
     * parent/child já adotada em page_edges (20260713185442). "root" deixa de
     * ser nome de coluna e vira convenção falada: qualquer página parent pode
     * ter colunas, não só a raiz da workspace.
     *
     * Diferente da migration de page_edges (que precisou recriar a tabela para
     * adicionar coluna e reescrever UNIQUE/FKs), aqui é um rename puro: o
     * ALTER TABLE RENAME COLUMN do SQLite preserva os dados intactos e
     * reescreve sozinho a FK que referencia pages(id).
     */
    `ALTER TABLE page_columns RENAME COLUMN page_root_id TO parent_id`,
  ],
  down: [
    // Restore: volta ao nome antigo, sem tocar nos dados.
    `ALTER TABLE page_columns RENAME COLUMN parent_id TO page_root_id`,
  ],
};
