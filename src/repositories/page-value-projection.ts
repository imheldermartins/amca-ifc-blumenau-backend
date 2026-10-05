import {ULID_RE} from '@/utils/ulid';

export const PAGE_VALUE_PROJECTION_VERSION = 1;
export type ProjectedValueKind = 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array' | 'missing';
export interface CellValueProjection {
  search_text: string | null;
  number_value: number | null;
  select_option_id: string | null;
  checkbox_value: number | null;
  date_start_ms: number | null;
  date_end_ms: number | null;
  value_kind: ProjectedValueKind;
  projection_version: number;
}

/** Same Unicode folding as the view predicate, independent of the host locale. */
export function normalizeSearchText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function titleValueProjection(title: unknown) {
  return {title_search: typeof title === 'string' ? normalizeSearchText(title) : null,
    projection_version: PAGE_VALUE_PROJECTION_VERSION};
}

function dateOperand(value: string): [number, number] | null {
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) return null;
  return [instant, /^\d{4}-\d{2}-\d{2}$/.test(value) ? instant + 86_400_000 - 1 : instant];
}

export function dateValueInterval(value: unknown): [number, number] | null {
  if (typeof value !== 'string') return null;
  const parts = value.includes('@') ? value.split('@') : [value];
  if (parts.length < 1 || parts.length > 2) return null;
  const operands = parts.map(dateOperand);
  if (operands.some((operand) => operand === null)) return null;
  return [Math.min(operands[0]![0], operands.at(-1)![0]), Math.max(operands[0]![1], operands.at(-1)![1])];
}

/** Derive from the actual decoded type; changing a column type never coerces old cells. */
export function deriveCellProjection(data: unknown): CellValueProjection {
  let value: unknown;
  try {
    const envelope: unknown = typeof data === 'string' ? JSON.parse(data) : data;
    value = envelope && typeof envelope === 'object' ? (envelope as {value?: unknown}).value : undefined;
  } catch { value = undefined; }
  const interval = dateValueInterval(value);
  return {
    search_text: typeof value === 'string' ? normalizeSearchText(value) : null,
    number_value: typeof value === 'number' && Number.isFinite(value) ? value : null,
    select_option_id: typeof value === 'string' && ULID_RE.test(value) ? value : null,
    checkbox_value: typeof value === 'boolean' ? Number(value) : null,
    date_start_ms: interval?.[0] ?? null,
    date_end_ms: interval?.[1] ?? null,
    value_kind: value === undefined ? 'missing' : value === null ? 'null' : Array.isArray(value) ? 'array'
      : typeof value as ProjectedValueKind,
    projection_version: PAGE_VALUE_PROJECTION_VERSION,
  };
}

export const CELL_PROJECTION_FIELDS = ['search_text', 'number_value', 'select_option_id', 'checkbox_value',
  'date_start_ms', 'date_end_ms', 'value_kind', 'projection_version'] as const;
export function cellProjectionValues(data: unknown): unknown[] {
  const projection = deriveCellProjection(data);
  return CELL_PROJECTION_FIELDS.map((field) => projection[field]);
}
