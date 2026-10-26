import db from '@models/index';
import type { Schema } from '@/db/schemas/index';
import { accessGuard, correlatedPageReadGuard } from './scoped-access-repository.js';
import relations from '@/repositories/page-relation-repository';
import formulas from '@/repositories/page-formula-repository';
import documents from './page-document-repository.js';
import { VALUE_CODECS } from '@/services/value-codec';
import type { RecursiveColumn, RecursiveRelation, RecursiveRow } from '@/services/pages/recursive-template';

export class PageExportStore {
  public document = (pageId: string) => documents.find(pageId);
  public async page(pageId: string, actor: string) {
    const guard = accessGuard('page', pageId, actor, 'read', 'view');
    const rows = await db.sqlRaw<{ id: string; title: string | null }>({ text: `SELECT id,title FROM pages WHERE id=? AND deleted_at IS NULL AND ${guard.text}`, values: [pageId, ...guard.values] }, 'query');
    return rows[0] ?? null;
  }
  public async parent(pageId: string): Promise<string | null> {
    const rows = await db.sqlRaw<{ parent_id: string }>({ text: 'SELECT parent_id FROM page_edges WHERE child_id=? LIMIT 1', values: [pageId] }, 'query');
    return rows[0]?.parent_id ?? null;
  }
  public async children(pageId: string, actor: string) {
    const guard = correlatedPageReadGuard('candidate.id', actor);
    const rows = await db.sqlRaw<{ id: NonEmptyString; title: string | null }>({ text: `SELECT candidate.id,candidate.title FROM pages candidate JOIN page_edges e ON e.child_id=candidate.id WHERE e.parent_id=? AND candidate.deleted_at IS NULL AND ${guard.text} ORDER BY candidate.id LIMIT 2001`, values: [pageId, ...guard.values] }, 'query');
    if (rows.length > 2000) throw new Error('A exportação suporta até 2000 filhas por página');
    return rows;
  }
  public async columns(pageId: string): Promise<Schema.PageColumn[]> {
    return (await db.pageColumns.findAll({ parent_id: pageId } as LookupsConfig<Schema.PageColumn>) ?? []).filter((column) => !column.deleted_at);
  }
  public async catalog(pageId: string, actor: string) {
    const [children, columns] = await Promise.all([this.children(pageId, actor), this.columns(pageId)]);
    const parentId = await this.parent(pageId);
    const inherited = parentId && await this.page(parentId, actor) ? await this.columns(parentId) : [];
    const recursiveRelations: RecursiveRelation[] = [];
    for (const column of [...columns, ...inherited]) {
      const target = column.type === 'relation' ? column.data?.relation?.targetDatabaseId : null;
      if (!target || !await this.page(target, actor)) continue;
      recursiveRelations.push({ id: column.id, name: column.name ?? '', columns: (await this.columns(target)).filter((col) => col.type !== 'flow').map<RecursiveColumn>((col) => ({ id: col.id, name: col.name ?? '', type: col.type })) });
    }
    return { children, columns: (columns.length ? columns : inherited).filter((col) => col.type !== 'flow').map<RecursiveColumn>((col) => ({ id: col.id, name: col.name ?? '', type: col.type })), relations: recursiveRelations };
  }
  /** Project only this row's selected Relation, preserving its 1/N order and target scope. */
  public async relationRows(pageId: string, relationColumnId: string, actor: string): Promise<RecursiveRow[] | null> {
    if (!await this.page(pageId, actor)) return null;
    const parentId = await this.parent(pageId);
    const inherited = parentId ? await this.columns(parentId) : [];
    const column = inherited.find((col) => col.id === relationColumnId && col.type === 'relation')
      ?? (await this.columns(pageId)).find((col) => col.id === relationColumnId && col.type === 'relation');
    const targetId = column?.data?.relation?.targetDatabaseId;
    if (!targetId || !await this.page(targetId, actor)) return null;
    const cells = await db.pageColumnValues.findAll({ page_id: pageId, page_column_id: relationColumnId } as LookupsConfig<Schema.PageColumnValue>) ?? [];
    let ids: string[] = [];
    try { const raw: unknown = cells[0] ? VALUE_CODECS.relation.decode(cells[0].data) : []; if (Array.isArray(raw)) ids = [...new Set(raw.filter((id): id is string => typeof id === 'string'))]; } catch { /* Invalid stored data has no printable targets. */ }
    if (!ids.length) return [];
    if (ids.length > 250) throw new Error('A Relação excede 250 páginas');
    const guard = correlatedPageReadGuard('candidate.id', actor);
    const visible = await db.sqlRaw<{ id: string; title: string | null }>({ text: `SELECT candidate.id,candidate.title FROM pages candidate JOIN page_edges e ON e.child_id=candidate.id WHERE e.parent_id=? AND candidate.id IN (${ids.map(() => '?').join(',')}) AND candidate.deleted_at IS NULL AND ${guard.text}`, values: [targetId, ...ids, ...guard.values] }, 'query');
    const columns = await this.columns(targetId);
    const rows: RecursiveRow[] = [];
    for (const id of ids) { const page = visible.find((entry) => entry.id === id); if (page) rows.push(await this.row(page, columns, actor)); }
    await this.calculated(rows, columns, targetId, actor);
    return rows;
  }
  public async row(page: { id: string; title: string | null }, columns: Schema.PageColumn[], actor?: string, loadedCells?: Schema.PageColumnValue[]): Promise<RecursiveRow> {
    const cells = loadedCells ?? await db.pageColumnValues.findAll({ page_id: page.id } as LookupsConfig<Schema.PageColumnValue>) ?? [];
    const row: RecursiveRow = { id: page.id, title: page.title ?? '', values: {}, dates: {} };
    for (const column of columns.filter((col) => col.type !== 'flow')) {
      const cell = cells.find((value) => value.page_column_id === column.id);
      if (!cell) continue;
      let raw: unknown;
      try { raw = VALUE_CODECS[column.type].decode(cell.data); } catch { continue; }
      if (column.type === 'date' && typeof raw === 'string') row.dates[column.id] = raw;
      row.values[column.id] = this.format(raw, column);
      if (column.type === 'relation' && Array.isArray(raw) && actor) {
        const targetId = column.data?.relation?.targetDatabaseId;
        const ids = [...new Set(raw.filter((id): id is string => typeof id === 'string'))];
        row.values[column.id] = '';
        if (targetId && ids.length && ids.length <= 250 && await this.page(targetId, actor)) {
          const guard = correlatedPageReadGuard('candidate.id', actor);
          const targets = await db.sqlRaw<{ id: string; title: string | null }>({ text: `SELECT candidate.id,candidate.title FROM pages candidate JOIN page_edges e ON e.child_id=candidate.id WHERE e.parent_id=? AND candidate.id IN (${ids.map(() => '?').join(',')}) AND candidate.deleted_at IS NULL AND ${guard.text}`, values: [targetId, ...ids, ...guard.values] }, 'query');
          const titles = new Map(targets.map((entry) => [entry.id, entry.title ?? '']));
          row.values[column.id] = ids.map((id) => titles.get(id) ?? '').filter(Boolean).join(', ');
        }
      }
    }
    return row;
  }
  public async calculated(rows: RecursiveRow[], columns: Schema.PageColumn[], parentId: string, actor: string) {
    // Rollup display settings are derived from the source column on read;
    // they are not stored as format/currency on the extract_as column itself.
    const rollups = await relations.resolveColumnMetadata(columns.filter((col) => col.type === 'extract_as'), actor);
    for (const column of rollups) {
      const values = await relations.resolveRollupValues(column, rows.map((row) => row.id), actor);
      const result = column.data?.rollupResult;
      for (const row of rows) row.values[column.id] = this.format(values[row.id], { ...column, type: 'numeric', data: result ?? {} });
    }
    const calculated = columns.filter((col) => col.type === 'formula');
    if (calculated.length && rows.length) {
      const display = (raw: unknown): string => raw == null ? '—' : Array.isArray(raw) ? raw.map(display).join(', ') : typeof raw === 'object' ? (raw as { kind?: string }).kind === 'markup' ? display((raw as { value?: unknown }).value) : '—' : typeof raw === 'boolean' ? raw ? 'Sim' : 'Não' : String(raw);
      for (let offset = 0; offset < rows.length; offset += 50) {
        const batch = rows.slice(offset, offset + 50);
        const values = await formulas.evaluateColumns(parentId, calculated.map((col) => ({ id: col.id, source: col.data?.formula?.source ?? '' })), batch.map((row) => row.id), actor);
        for (const col of calculated) for (const row of batch) { const value = values[col.id]?.[row.id]; row.values[col.id] = value?.ok ? display(value.value) : value?.error.message ?? 'Fórmula indisponível'; }
      }
    }
  }
  private format(raw: unknown, column: Schema.PageColumn): string {
    if (raw == null) return '';
    switch (column.type) {
      case 'checkbox': return raw ? 'Sim' : 'Não';
      case 'select': return column.data?.options?.find((option) => option.id === raw)?.value ?? '';
      case 'numeric': return typeof raw === 'number' ? column.data?.format === 'currency' ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Math.round(raw) / 100) : column.data?.format === 'percentage' ? `${Number(String(raw).replace(/\D/g, '').slice(0, 3))}%` : String(raw) : '';
      case 'date': return typeof raw === 'string' ? raw.split('@').map((part) => /^\d{4}-\d{2}-\d{2}/.test(part) ? `${part.slice(8, 10)}/${part.slice(5, 7)}/${part.slice(0, 4)}${part.slice(11, 16) !== '00:00' && part.length > 10 ? ` ${part.slice(11, 16)}` : ''}` : '').join(' – ') : '';
      // IDs and executable values must never be exposed as printable text.
      case 'relation': return '';
      case 'formula': case 'extract_as': return typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean' ? String(raw) : '';
      default: return typeof raw === 'string' ? raw : '';
    }
  }
}
export default new PageExportStore();
