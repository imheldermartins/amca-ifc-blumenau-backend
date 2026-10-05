import { ulid } from 'ulid';
import {CELL_PROJECTION_FIELDS, cellProjectionValues} from '@/repositories/page-value-projection';

/** Upsert canônico de uma célula; útil em transações compostas. */
export function pageCellUpsertStatement(
  pageId: string,
  columnId: string,
  data: string,
): RqliteStatement {
  return [
    `INSERT INTO page_columns_values (id, data, page_column_id, page_id, ${CELL_PROJECTION_FIELDS.join(', ')})
      VALUES (?, ?, ?, ?, ${CELL_PROJECTION_FIELDS.map(() => '?').join(', ')})
      ON CONFLICT(page_id, page_column_id) DO UPDATE SET
        data = excluded.data, ${CELL_PROJECTION_FIELDS.map((field) => `${field} = excluded.${field}`).join(', ')},
        updated_at = CURRENT_TIMESTAMP`,
    ulid(), data, columnId, pageId, ...cellProjectionValues(data),
  ];
}
