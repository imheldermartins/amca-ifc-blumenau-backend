import { type Migration } from '../migrator.js';

export const migration: Migration = {
  id: '20260721013438_rename_page_users_to_page_members',
  up: [
    /**
     * page_users -> page_members. "Membro" é o nome do domínio (as rotas já
     * nascem em /pages/:id/members) e evita a confusão com a tabela `users`,
     * que guarda a PESSOA -- aqui o registro é o VÍNCULO dela com a página.
     *
     * Rename puro: o ALTER TABLE RENAME TO do SQLite preserva dados, índices e
     * as FKs que apontam para pages/users, então não há tempCache aqui (mesmo
     * espírito do rename de page_columns.page_root_id -> parent_id).
     */
    `ALTER TABLE page_users RENAME TO page_members`,
  ],
  down: [
    // Restore: volta ao nome antigo, sem tocar nos dados.
    `ALTER TABLE page_members RENAME TO page_users`,
  ],
};
