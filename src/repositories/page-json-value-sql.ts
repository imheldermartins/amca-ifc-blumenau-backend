/** Read the canonical envelope in SQL; no persisted copy of a value or its type. */
export function cellJsonSql(alias: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw new Error('Invalid SQL alias');
  return `CASE WHEN json_valid(${alias}.data) THEN ${alias}.data ELSE '{}' END`;
}

export function cellValueSql(alias: string): string {
  return `json_extract(${cellJsonSql(alias)}, '$.value')`;
}

export function cellTypeSql(alias: string): string {
  return `json_type(${cellJsonSql(alias)}, '$.value')`;
}

/** ISO dates/ranges are evaluated only at read time. Aliases are not schema fields. */
export function cellDateIntervalSql(alias: string): { start: string; end: string } {
  const value = cellValueSql(alias), kind = cellTypeSql(alias);
  const first = `CASE WHEN instr(${value}, '@') > 0 THEN substr(${value}, 1, instr(${value}, '@') - 1) ELSE ${value} END`;
  const last = `CASE WHEN instr(${value}, '@') > 0 THEN substr(${value}, instr(${value}, '@') + 1) ELSE ${value} END`;
  const milliseconds = (date: string) => `CAST(round((julianday(${date}) - 2440587.5) * 86400000) AS INTEGER)`;
  const start = milliseconds(first), finish = milliseconds(last);
  const dayEnd = (date: string, ms: string) => `(${ms} + CASE WHEN length(${date}) = 10 THEN 86399999 ELSE 0 END)`;
  const valid = `${kind} = 'text' AND instr(${last}, '@') = 0`;
  return {
    start: `CASE WHEN ${valid} THEN min(${start}, ${finish}) END`,
    end: `CASE WHEN ${valid} THEN max(${dayEnd(first, start)}, ${dayEnd(last, finish)}) END`,
  };
}
