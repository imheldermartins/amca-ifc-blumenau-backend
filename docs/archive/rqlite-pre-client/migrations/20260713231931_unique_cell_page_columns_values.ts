import { type Migration } from '../migrator.js';

export const migration: Migration = {
  id: '20260713231931_unique_cell_page_columns_values',
  up: [
    /**
     * Uma célula (page_id, page_column_id) tem no máximo UM valor — contrato da
     * rota singular /pages/:id/column/:column_id/value. O índice UNIQUE grava a
     * regra no banco (mesmo espírito do UNIQUE(parent_id, child_id) de
     * page_edges): o app devolve 409 antes, e o índice segura corrida/bypass.
     * Dados atuais verificados sem duplicatas antes desta migration.
     */
    `CREATE UNIQUE INDEX idx_page_columns_values_cell
      ON page_columns_values (page_id, page_column_id)`,
  ],
  down: [
    `DROP INDEX IF EXISTS idx_page_columns_values_cell`,
  ],
};
