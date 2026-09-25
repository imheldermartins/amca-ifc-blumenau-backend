import { type Migration } from '../migrator.js';

export const migration: Migration = {
  id: '20260713185442_rename_page_edges_columns_add_slug',
  up: [
    /**
     * Renomeia as colunas de page_edges para a convenção parent/child e adiciona
     * `slug` (usado pelo breadcrumb recursivo):
     *   page_root_id -> parent_id
     *   page_id      -> child_id
     *   (+ slug TEXT)
     *
     * O SQLite tem ALTER TABLE RENAME COLUMN, mas aqui usamos o padrão
     * "recria a tabela" com um tempCache para: (a) preservar os dados intactos,
     * (b) adicionar a coluna slug e (c) reescrever as FKs/UNIQUE com os nomes
     * novos numa tacada só. A migration roda como um batch único no rqlite.
     */

    // 1. tempCache: cópia crua dos dados atuais (id, page_root_id, page_id, timestamps).
    `CREATE TABLE page_edges_cache AS SELECT * FROM page_edges`,

    // 2. remove a tabela antiga.
    `DROP TABLE page_edges`,

    // 3. recria com a convenção nova (parent_id/child_id) + slug.
    `CREATE TABLE page_edges (
      id BLOB PRIMARY KEY NOT NULL,
      parent_id BLOB NOT NULL,
      child_id BLOB NOT NULL,
      slug TEXT,
      created_at DEFAULT CURRENT_TIMESTAMP,
      updated_at DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(parent_id) REFERENCES pages (id),
      FOREIGN KEY(child_id) REFERENCES pages (id),
      UNIQUE(parent_id, child_id)
    )`,

    // 4. restore: mapeia page_root_id->parent_id, page_id->child_id e faz backfill
    //    best-effort do slug a partir do título da página-filha (minúsculo,
    //    espaços -> '-'). É SQL cru, então não remove acentos -- edges NOVOS
    //    (criados pelo controller/seed) usam o slugify próprio, que normaliza.
    `INSERT INTO page_edges (id, parent_id, child_id, slug, created_at, updated_at)
      SELECT
        c.id,
        c.page_root_id,
        c.page_id,
        lower(replace(trim((SELECT p.title FROM pages p WHERE p.id = c.page_id)), ' ', '-')),
        c.created_at,
        c.updated_at
      FROM page_edges_cache c`,

    // 5. descarta o tempCache.
    `DROP TABLE page_edges_cache`
  ],
  down: [
    // Reverte para page_root_id/page_id (descarta slug), mesmo padrão tempCache.
    `CREATE TABLE page_edges_cache AS SELECT * FROM page_edges`,
    `DROP TABLE page_edges`,
    `CREATE TABLE page_edges (
      id BLOB PRIMARY KEY NOT NULL,
      page_root_id BLOB NOT NULL,
      page_id BLOB NOT NULL,
      created_at DEFAULT CURRENT_TIMESTAMP,
      updated_at DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(page_root_id) REFERENCES pages (id),
      FOREIGN KEY(page_id) REFERENCES pages (id),
      UNIQUE(page_root_id, page_id)
    )`,
    `INSERT INTO page_edges (id, page_root_id, page_id, created_at, updated_at)
      SELECT id, parent_id, child_id, created_at, updated_at FROM page_edges_cache`,
    `DROP TABLE page_edges_cache`
  ]
};
