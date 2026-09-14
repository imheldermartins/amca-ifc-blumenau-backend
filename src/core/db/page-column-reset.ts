const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

export interface CellResetWrite {
  id: string;
  clear: boolean;
  data?: string;
}

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
      'UPDATE page_columns_values SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND page_column_id = ?',
      write.data,
      write.id,
      columnId,
    ];
  });
}
