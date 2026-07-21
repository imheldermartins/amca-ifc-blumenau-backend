import { type Migration } from '../migrator.js';

export const migration: Migration = {
  id: '20260721175050_rename_page_members_to_page_collaborators',
  up: [
    /**
     * page_members -> page_collaborators. "Colaborador" é o nome que o produto
     * usa (a aba "Colaborando" do frontend) e diz o que o vínculo SIGNIFICA:
     * quem trabalha junto naquela página. "Membro" era genérico demais num
     * sistema que também tem membros de workspace e de turma.
     *
     * Rename puro: o ALTER TABLE RENAME TO do SQLite preserva dados, índices e
     * as FKs que apontam para pages/users -- mesmo espírito do rename anterior
     * (page_users -> page_members).
     */
    `ALTER TABLE page_members RENAME TO page_collaborators`,
  ],
  down: [
    // Restore: volta ao nome antigo, sem tocar nos dados.
    `ALTER TABLE page_collaborators RENAME TO page_members`,
  ],
};
