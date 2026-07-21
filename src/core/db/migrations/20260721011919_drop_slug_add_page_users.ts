import { type Migration } from '../migrator.js';

export const migration: Migration = {
  id: '20260721011919_drop_slug_add_page_users',
  up: [
    /**
     * (1) Remove `slug` de page_edges. O segmento de caminho deixou de existir
     * como conceito -- o breadcrumb passa a subir a árvore só por id/parent_id.
     * SQLite 3.35+ (o rqlite roda 3.53) tem ALTER TABLE DROP COLUMN, e como
     * `slug` não participa de UNIQUE/FK/índice, o drop é direto (sem recriar a
     * tabela). Os dados de slug são descartados de propósito.
     */
    `ALTER TABLE page_edges DROP COLUMN slug`,

    /**
     * (2) page_users: vínculo N:N entre páginas e usuários com ACESSO àquela
     * página (além do owner_id da própria pages). Mesma convenção das outras
     * tabelas-ponte (page_edges): id BLOB, FKs para pages/users, timestamps e
     * UNIQUE no par para impedir o mesmo usuário duas vezes na mesma página.
     */
    `CREATE TABLE IF NOT EXISTS page_users (
      id BLOB PRIMARY KEY NOT NULL,
      page_id BLOB NOT NULL,
      user_id BLOB NOT NULL,
      created_at DEFAULT CURRENT_TIMESTAMP,
      updated_at DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(page_id) REFERENCES pages (id),
      FOREIGN KEY(user_id) REFERENCES users (id),
      UNIQUE(page_id, user_id)
    )`
  ],
  down: [
    // Reverte na ordem inversa: derruba page_users e devolve o slug (nullable,
    // sem restaurar dados -- eram best-effort).
    `DROP TABLE IF EXISTS page_users`,
    `ALTER TABLE page_edges ADD COLUMN slug TEXT`
  ]
};
