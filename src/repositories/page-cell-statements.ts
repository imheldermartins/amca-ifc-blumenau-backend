import { ulid } from 'ulid';

/** Upsert canônico de uma célula; útil em transações compostas. */
export function pageCellUpsertStatement(
  pageId: string,
  columnId: string,
  data: string,
): RqliteStatement {
  return [
    `INSERT INTO page_columns_values (id, data, page_column_id, page_id)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(page_id, page_column_id) DO UPDATE SET
        data = excluded.data,
        updated_at = CURRENT_TIMESTAMP`,
    ulid(), data, columnId, pageId,
  ];
}
