/** Portable Recursive configuration and read-only projection. No I/O or stored row values. */
export interface RecursiveField { id: string; label: string; text: string }
export interface RecursiveTableCell { id: string; column: number; text: string; colSpan: number; rowSpan: number; header: boolean; horizontalAlign?: 'left' | 'center' | 'right' | 'justify'; verticalAlign?: 'top' | 'middle' | 'bottom' }
export interface RecursiveTableRow { id: string; mode: 'static' | 'repeat'; cells: RecursiveTableCell[] }
export interface RecursiveTable { columns: number; rows: RecursiveTableRow[] }
export interface RecursiveConfig { version: 1; fields: RecursiveField[]; dateColumnId: string | null; relationColumnId: string | null; table?: RecursiveTable }
export interface RecursiveColumn { id: string; name: string; type: string }
export interface RecursiveRelation { id: string; name: string; columns: RecursiveColumn[] }
export interface RecursiveRow { id: string; title: string; values: Record<string, string>; dates: Record<string, string> }
export const CHILD_TITLE = 'recursive:child:title';
export const childColumn = (id: string) => `recursive:child:columns.${id}`;
export const recursiveToken = (id: string) => `@{${id}}`;
export const PDF_TITLE = 'pdf:page:title';
export const pdfColumn = (id: string) => `pdf:page:columns.${id}`;
export const relationTitle = (id: string) => `recursive:relation:${id}:title`;
export const relationColumn = (relationId: string, columnId: string) => `recursive:relation:${relationId}:columns.${columnId}`;
const bounded = (value: unknown, fallback: number, max: number) => typeof value === 'number' && Number.isInteger(value) ? Math.max(1, Math.min(max, value)) : fallback;
/** Keep a rectangular table; spans cannot overlap or cross a static/repeated row boundary. */
export function normalizeRecursiveTable(input: unknown): RecursiveTable | undefined {
  if (!input || typeof input !== 'object') return;
  const raw = input as Partial<RecursiveTable>;
  if (!Array.isArray(raw.rows) || !raw.rows.length) return;
  const columns = bounded(raw.columns, 2, 40);
  const rows = raw.rows.slice(0, 60).map((row, index): RecursiveTableRow => ({ id: typeof row?.id === 'string' ? row.id : `row-${index}`, mode: row?.mode === 'repeat' ? 'repeat' : 'static', cells: [] }));
  const occupied = rows.map(() => Array<boolean>(columns).fill(false));
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y]!;
    const candidates = Array.isArray(raw.rows[y]?.cells) ? raw.rows[y]!.cells.slice(0, columns) : [];
    for (const cell of candidates) {
      if (!cell || !Number.isInteger(cell.column) || cell.column < 0 || cell.column >= columns || occupied[y]![cell.column]) continue;
      let colSpan = bounded(cell.colSpan, 1, columns - cell.column);
      while (colSpan > 1 && occupied[y]!.slice(cell.column, cell.column + colSpan).some(Boolean)) colSpan--;
      let maxRows = 1;
      while (y + maxRows < rows.length && rows[y + maxRows]!.mode === row.mode) maxRows++;
      let rowSpan = bounded(cell.rowSpan, 1, maxRows);
      while (rowSpan > 1 && occupied.slice(y, y + rowSpan).some((line) => line.slice(cell.column, cell.column + colSpan).some(Boolean))) rowSpan--;
      const normalized: RecursiveTableCell = { id: typeof cell.id === 'string' ? cell.id : `${row.id}-${cell.column}`, column: cell.column, text: typeof cell.text === 'string' ? cell.text.slice(0, 4000) : '', colSpan, rowSpan, header: cell.header === true };
      if (cell.horizontalAlign === 'center' || cell.horizontalAlign === 'right' || cell.horizontalAlign === 'justify') normalized.horizontalAlign = cell.horizontalAlign;
      if (cell.verticalAlign === 'middle' || cell.verticalAlign === 'bottom') normalized.verticalAlign = cell.verticalAlign;
      row.cells.push(normalized);
      for (let dy = 0; dy < rowSpan; dy++) for (let dx = 0; dx < colSpan; dx++) occupied[y + dy]![cell.column + dx] = true;
    }
    for (let x = 0; x < columns; x++) if (!occupied[y]![x]) {
      row.cells.push({ id: `${row.id}-cell-${x}`, column: x, text: '', colSpan: 1, rowSpan: 1, header: false });
      occupied[y]![x] = true;
    }
    row.cells.sort((a, b) => a.column - b.column);
  }
  return { columns, rows };
}
/** Upgrade legacy field lists without storing cell values from any page. */
export function recursiveTable(config: RecursiveConfig): RecursiveTable {
  if (config.table) return config.table;
  const fields = config.fields.length ? config.fields.slice(0, 40) : defaultRecursiveConfig().fields;
  const scoped = (text: string) => config.relationColumnId ? text.replaceAll(recursiveToken(CHILD_TITLE), recursiveToken(relationTitle(config.relationColumnId))).replace(/@\{recursive:child:columns\.([^{}]+)\}/g, (_token, id: string) => recursiveToken(relationColumn(config.relationColumnId!, id))) : text;
  return { columns: fields.length, rows: [
    { id: 'header', mode: 'static', cells: fields.map((field, column) => ({ id: `header-${field.id}`, column, text: field.label, colSpan: 1, rowSpan: 1, header: true })) },
    { id: 'items', mode: 'repeat', cells: fields.map((field, column) => ({ id: `item-${field.id}`, column, text: scoped(field.text), colSpan: 1, rowSpan: 1, header: false })) },
  ] };
}
export function defaultRecursiveConfig(): RecursiveConfig {
  return { version: 1, fields: [{ id: 'title', label: 'Título', text: recursiveToken(CHILD_TITLE) }], dateColumnId: null, relationColumnId: null };
}
export function readRecursiveConfig(input: unknown): RecursiveConfig {
  if (!input || typeof input !== 'object') return defaultRecursiveConfig();
  const value = input as Partial<RecursiveConfig>;
  const table = normalizeRecursiveTable(value.table);
  return { version: 1, relationColumnId: typeof value.relationColumnId === 'string' ? value.relationColumnId : null, dateColumnId: typeof value.dateColumnId === 'string' ? value.dateColumnId : null,
    ...(table ? { table } : {}),
    fields: Array.isArray(value.fields) ? value.fields.slice(0, 40).filter((field) => field && typeof field.id === 'string' && typeof field.label === 'string' && typeof field.text === 'string') : defaultRecursiveConfig().fields };
}
export function recursiveText(text: string, row: RecursiveRow | null, fallback: (id: string) => string = () => '', relationId?: string | null): string {
  return text.replace(/@\{([^{}]{1,1600})\}/g, (_token, id: string) => id === CHILD_TITLE ? row?.title ?? ''
    : id.startsWith('recursive:child:columns.') ? row?.values[id.slice(24)] ?? ''
      : relationId && id === relationTitle(relationId) ? row?.title ?? ''
        : relationId && id.startsWith(`recursive:relation:${relationId}:columns.`) ? row?.values[id.slice(`recursive:relation:${relationId}:columns.`.length)] ?? '' : fallback(id));
}
export const escapeExportHtml = (text: string) => text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
export function recursiveTableHtml(config: RecursiveConfig, rows: RecursiveRow[], fallback?: (id: string) => string): string {
  const table = recursiveTable(config);
  const render = (line: RecursiveTableRow, context: RecursiveRow | null) => `<tr>${line.cells.map((cell) => {
    const tag = cell.header ? 'th' : 'td';
    const styles = [cell.horizontalAlign ? `text-align:${cell.horizontalAlign}` : '', cell.verticalAlign ? `vertical-align:${cell.verticalAlign}` : ''].filter(Boolean).join(';');
    return `<${tag} colspan="${cell.colSpan}" rowspan="${cell.rowSpan}"${styles ? ` style="${styles}"` : ''}>${escapeExportHtml(recursiveText(cell.text, context, fallback, config.relationColumnId))}</${tag}>`;
  }).join('')}</tr>`;
  const header: string[] = [], body: string[] = [];
  for (let index = 0; index < table.rows.length;) {
    const line = table.rows[index]!;
    if (line.mode === 'repeat') {
      const group: RecursiveTableRow[] = [];
      while (table.rows[index]?.mode === 'repeat') group.push(table.rows[index++]!);
      for (const row of rows) body.push(...group.map((entry) => render(entry, row)));
    } else { (body.length === 0 && line.cells.length > 0 && line.cells.every((cell) => cell.header) ? header : body).push(render(line, null)); index++; }
  }
  return `<table class="recursive-table"><colgroup>${Array.from({ length: table.columns }, () => '<col>').join('')}</colgroup>${header.length ? `<thead>${header.join('')}</thead>` : ''}<tbody>${body.join('')}</tbody></table>`;
}
const dayMs = 86_400_000;
function dateInstant(raw: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}\.\d{3}Z)?$/.test(raw)) return null;
  const time = Date.parse(raw.length === 10 ? `${raw}T00:00:00.000Z` : raw);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, raw.length) === raw ? time : null;
}
export interface RecursiveMonth { key: string; days: { date: string; rows: RecursiveRow[] }[] }
/** Civil UTC days match the existing stored date codec; inclusive date ranges occupy every day. */
export function recursiveMonths(config: RecursiveConfig, rows: RecursiveRow[]): RecursiveMonth[] {
  const occupied = new Map<string, RecursiveRow[]>();
  for (const row of rows) {
    const raw = config.dateColumnId ? row.dates[config.dateColumnId] : undefined;
    if (!raw) continue;
    const parts = raw.split('@');
    if (parts.length > 2) continue;
    const start = dateInstant(parts[0]!), end = dateInstant(parts[1] ?? parts[0]!);
    if (start === null || end === null || end < start) continue;
    // Reject oversized projections explicitly; never silently omit cards.
    if ((end - start) / dayMs > 3660) throw new Error('Intervalo do calendário excede 10 anos');
    const allDay = parts.every((part) => part.length === 10 || part.endsWith('T00:00:00.000Z'));
    const lastDay = !allDay && parts.length === 2 && end > start ? end - 1 : end;
    for (let at = Math.floor(start / dayMs) * dayMs; at <= Math.floor(lastDay / dayMs) * dayMs; at += dayMs) {
      const day = new Date(at).toISOString().slice(0, 10);
      occupied.set(day, [...occupied.get(day) ?? [], row]);
      if (occupied.size > 3660) throw new Error('Calendário excede 3660 dias');
    }
  }
  return [...new Set([...occupied.keys()].map((day) => day.slice(0, 7)))].sort().map((key) => {
    const first = new Date(`${key}-01T00:00:00Z`), last = new Date(first);
    last.setUTCMonth(last.getUTCMonth() + 1); last.setUTCDate(0);
    const days = Array.from({ length: last.getUTCDate() }, (_, i) => {
      const date = `${key}-${String(i + 1).padStart(2, '0')}`;
      return { date, rows: occupied.get(date) ?? [] };
    });
    return { key, days };
  });
}
export function recursiveCalendarHtml(config: RecursiveConfig, rows: RecursiveRow[], fallback?: (id: string) => string): string {
  return recursiveMonths(config, rows).map((month) => {
    const first = new Date(`${month.key}-01T00:00:00Z`);
    const heading = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(first);
    const cells = [...Array.from({ length: first.getUTCDay() }, () => '<td class="empty"></td>'), ...month.days.map((day) => `<td><span class="day-number">${Number(day.date.slice(8))}</span>${day.rows.map((row) => `<article><strong>${escapeExportHtml(row.title)}</strong>${config.fields.filter((field) => field.text !== recursiveToken(CHILD_TITLE) && field.text !== recursiveToken(relationTitle(config.relationColumnId ?? ''))).map((field) => `<div>${field.label ? `<b>${escapeExportHtml(field.label)}: </b>` : ''}${escapeExportHtml(recursiveText(field.text, row, fallback, config.relationColumnId))}</div>`).join('')}</article>`).join('')}</td>`)];
    while (cells.length % 7) cells.push('<td class="empty"></td>');
    return `<section class="recursive-month" data-month="${month.key}"><h2>${escapeExportHtml(heading)}</h2><table class="recursive-calendar"><thead><tr>${['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((day) => `<th>${day}</th>`).join('')}</tr></thead><tbody>${Array.from({ length: cells.length / 7 }, (_, i) => `<tr>${cells.slice(i * 7, i * 7 + 7).join('')}</tr>`).join('')}</tbody></table></section>`;
  }).join('');
}
export const RECURSIVE_CSS = `.recursive-table,.recursive-calendar{width:100%;border-collapse:collapse;table-layout:fixed;font-size:12px}.recursive-table th,.recursive-table td,.recursive-calendar th,.recursive-calendar td{border:1px solid #ddd;padding:8px;vertical-align:top;overflow-wrap:anywhere;white-space:pre-wrap}.recursive-table th,.recursive-table td{padding:5px 8px;line-height:1.35}.recursive-table th,.recursive-calendar th{background:#f6f5f8;text-align:left}.recursive-calendar td{height:72px;padding:4px}.recursive-calendar article{margin-top:4px;padding:5px;background:#f3edfc;border-left:2px solid #8150bd;border-radius:3px;font-size:10px;break-inside:avoid}.recursive-calendar article strong{display:block}.recursive-month{margin:20px 0}.recursive-month h2{font-size:18px;text-transform:capitalize;break-after:avoid}.day-number{font-size:10px;color:#666}thead{display:table-header-group}tr{break-inside:avoid}`;
