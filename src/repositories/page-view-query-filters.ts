import type { QueryFilterClause } from '@/services/pages/views/page-view-query-contract';
import {simplifySqlText, simplifyText} from '@/utils/slugify';
import {cellDateIntervalSql, cellTypeSql, cellValueSql} from '@/repositories/page-json-value-sql';

export interface QueryColumn { id: string; name: string | null; type: string | null; data: Record<string, unknown> | null; parent_id?: string | null }
export interface QuerySqlFragment { text: string; values: unknown[] }
export interface CompiledQueryFilters { joins: QuerySqlFragment; where: QuerySqlFragment }

export function normalizeQueryText(value: string): string {
  return simplifyText(value);
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
    const value = cellValueSql(alias);
    const textValue = simplifySqlText(title ? 'candidate.title' : value);
    const kind = title ? "CASE WHEN candidate.title IS NULL THEN 'null' ELSE 'text' END" : cellTypeSql(alias);
    if (type === 'text' && operands.length === 1 && (clause.condition === 'equals' || clause.condition === 'contains' && operands[0]!.length > 0)) {
      predicate = `${kind} = 'text' AND ${clause.condition === 'equals' ? `${textValue} = ?` : `instr(${textValue}, ?) > 0`}`;
      expected = [normalizeQueryText(operands[0]!)];
    } else if (type === 'numeric' && operands.length === 1 && operands[0]!.trim() && Number.isFinite(Number(operands[0])) && ['equals', 'greaterThan', 'lessThan'].includes(clause.condition)) {
      predicate = `${kind} IN ('integer','real') AND ${value} ${clause.condition === 'equals' ? '=' : clause.condition === 'greaterThan' ? '>' : '<'} ?`;
      expected = [Number(operands[0])];
    } else if (type === 'select' && clause.condition === 'equals' && operands.length > 0 && operands.every((value) => value.trim().length > 0)) {
      predicate = `${kind} = 'text' AND ${value} IN (${operands.map(() => '?').join(',')})`;
      expected = [...operands];
    } else if (type === 'checkbox' && clause.condition === 'equals' && operands.length === 1 && ['true', 'false'].includes(operands[0]!)) {
      predicate = operands[0] === 'true' ? `${kind} = 'true'`
        : `(${kind} = 'false' OR ${kind} IS NULL OR ${kind} = 'null')`;
    } else if (type === 'date' && (clause.condition === 'equals' && operands.length === 1 || clause.condition === 'between' && operands.length === 2)) {
      const dates = operands.map(dateOperand);
      if (dates.some((date) => date === null)) continue;
      const intervals = dates as { start: number; end: number }[];
      const interval = cellDateIntervalSql(alias);
      predicate = `${interval.start} <= ? AND ${interval.end} >= ?`;
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
