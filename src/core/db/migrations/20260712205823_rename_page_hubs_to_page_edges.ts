import { type Migration } from '../migrator.js';

export const migration: Migration = {
  id: '20260712205823_rename_page_hubs_to_page_edges',
  up: [
    /**
     * Renomeia page_hubs -> page_edges.
     * A tabela modela as arestas (edges) entre páginas: cada registro liga uma
     * página-filha (page_id) a uma página raiz (page_root_id). O novo nome reflete
     * essa semântica de grafo (nós = pages, arestas = page_edges).
     *
     * ALTER TABLE ... RENAME TO preserva dados, índices e a constraint UNIQUE.
     * Nenhuma outra tabela referencia page_hubs por FOREIGN KEY, então o rename
     * não deixa referências pendentes.
     */
    `ALTER TABLE page_hubs RENAME TO page_edges`
  ],
  down: [
    `ALTER TABLE page_edges RENAME TO page_hubs`
  ]
};
