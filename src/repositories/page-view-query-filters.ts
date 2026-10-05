import type { QueryFilterClause } from '@/services/pages/views/page-view-query-contract';
import { normalizeSearchText } from '@/repositories/page-value-projection';

export interface QueryColumn { id: string; name: string | null; type: string | null; data: Record<string, unknown> | null }
export interface QuerySqlFragment { text: string; values: unknown[] }
export interface CompiledQueryFilters { joins: QuerySqlFragment; where: QuerySqlFragment }

export function normalizeQueryText(value: string): string {
  return normalizeSearchText(value);
}

function dateOperand(value: string): { start: number; end: number } | null {
  const start = Date.parse(value);
  if (!Number.isFinite(start)) return null;
  return { start, end: start + (/^\d{4}-\d{2}-\d{2}$/.test(value) ? 86_400_000 - 1 : 0) };
}

/** Matches the frontend predicate, including ignored incomplete clauses. */
export function compileQueryFilters(columns: readonly QueryColumn[], clauses: readonly QueryFilterClause[]): CompiledQueryFilters {
  const joins: string[] = [], joinValues: unknown[] = [], where: string[] = [], values: unknown[] = [];
  const byId = new Map(columns.map((column) => [column.id, column]));
  for (const clause of clauses) {
    const title = clause.columnId === 'page_title';
    const type = title ? 'text' : byId.get(clause.columnId)?.type;
    const operands = clause.values;
    if (!type || type === 'flow') continue;
    const alias = `filter_${joins.length}`;
    let predicate = '', expected: unknown[] = [];
    const textValue = title ? 'candidate.title_search' : `${alias}.search_text`;
    const kind = title ? "CASE WHEN candidate.title IS NULL THEN 'null' ELSE 'string' END" : `${alias}.value_kind`;
    if (type === 'text' && operands.length === 1 && (clause.condition === 'equals' || clause.condition === 'contains' && operands[0]!.length > 0)) {
      predicate = `${kind} = 'string' AND ${clause.condition === 'equals' ? `${textValue} = ?` : `instr(${textValue}, ?) > 0`}`;
      expected = [normalizeQueryText(operands[0]!)];
    } else if (type === 'numeric' && operands.length === 1 && operands[0]!.trim() && Number.isFinite(Number(operands[0])) && ['equals', 'greaterThan', 'lessThan'].includes(clause.condition)) {
      predicate = `${kind} = 'number' AND ${alias}.number_value ${clause.condition === 'equals' ? '=' : clause.condition === 'greaterThan' ? '>' : '<'} ?`;
      expected = [Number(operands[0])];
    } else if (type === 'select' && clause.condition === 'equals' && operands.length > 0 && operands.every((value) => value.trim().length > 0)) {
      predicate = `${kind} = 'string' AND ${alias}.select_option_id IN (${operands.map(() => '?').join(',')})`;
      expected = [...operands];
    } else if (type === 'checkbox' && clause.condition === 'equals' && operands.length === 1 && ['true', 'false'].includes(operands[0]!)) {
      predicate = operands[0] === 'true' ? `${kind} = 'boolean' AND ${alias}.checkbox_value = 1`
        : `(${kind} = 'boolean' AND ${alias}.checkbox_value = 0 OR ${alias}.id IS NULL OR ${kind} IN ('null', 'missing'))`;
    } else if (type === 'date' && (clause.condition === 'equals' && operands.length === 1 || clause.condition === 'between' && operands.length === 2)) {
      const dates = operands.map(dateOperand);
      if (dates.some((date) => date === null)) continue;
      const intervals = dates as { start: number; end: number }[];
      predicate = `${alias}.date_start_ms <= ? AND ${alias}.date_end_ms >= ?`;
      expected = [Math.max(...intervals.map((date) => date.end)), Math.min(...intervals.map((date) => date.start))];
    }
    if (!predicate) continue;
    if (!title) {
      joins.push(`LEFT JOIN page_columns_values ${alias} ON ${alias}.page_id = candidate.id AND ${alias}.page_column_id = ?`);
      joinValues.push(clause.columnId);
    }
    where.push(`(${predicate})`);
    values.push(...expected);
  }
  return { joins: { text: joins.join('\n'), values: joinValues }, where: { text: where.length ? where.join(' AND ') : '1', values } };
}
