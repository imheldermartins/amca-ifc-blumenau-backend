const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
import type { CellResetWrite } from "@/repositories/types/page-column-reset.types";
export type { CellResetWrite } from "@/repositories/types/page-column-reset.types";
import {CELL_PROJECTION_FIELDS, cellProjectionValues} from '@/repositories/page-value-projection';

/** Writes de células agrupados com a definição da coluna e o relógio da base. */
export function pageColumnResetStatements(columnId: string, writes: readonly CellResetWrite[]): RqliteStatement[] {
  if (!ULID_RE.test(columnId)) throw new Error('Invalid column id');
  return writes.map((write) => {
    if (!ULID_RE.test(write.id)) throw new Error('Invalid value id');
    if (write.clear) {
      return ['DELETE FROM page_columns_values WHERE id = ? AND page_column_id = ?', write.id, columnId];
    }
    if (typeof write.data !== 'string') throw new Error('Missing encoded value');
    return [
      `UPDATE page_columns_values SET data = ?, ${CELL_PROJECTION_FIELDS.map((field) => `${field} = ?`).join(', ')},
        updated_at = CURRENT_TIMESTAMP WHERE id = ? AND page_column_id = ?`,
      write.data,
      ...cellProjectionValues(write.data),
      write.id,
      columnId,
    ];
  });
}
