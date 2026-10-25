import {ulid} from 'ulid';
import db from '@models/index';
import {rqlite} from '@/db/client-db';
import type {Schema} from '@/db/schemas/index';
import {VALUE_CODECS} from '@/services/value-codec';
import {accessGuard} from '@/repositories/scoped-access-repository';
import {pageActivityTouchStatement} from '@/repositories/page-activity';
import {PageRelationError} from '@/repositories/page-relation-repository';
import {allocateDuplicateLabel, collectReservedPublicKeys, reconcilePublicKeyMetadata} from '@/services/public-key';
import {collectPageColumnReservations} from '@/services/filter-key-registry';

type Commit = (statements: RqliteStatement[], endpoint: 'execute', options: {transaction: true}) => Promise<boolean[]>;
type Cell = Schema.PageColumnValue;
type Definition = Pick<Schema.PageColumn, 'id' | 'name' | 'type' | 'parent_id' | 'data'>;
interface Plan { guards: RqliteStatement[]; writes: RqliteStatement[]; pages: Set<string> }
const now = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const decode = (cell?: Cell | null): string[] => cell ? VALUE_CODECS.relation.decode(cell.data) as string[] : [];
const encode = (ids: string[]) => VALUE_CODECS.relation.encode(ids);
const plan = (): Plan => ({guards: [], writes: [], pages: new Set()});

/** Both snapshots and their SQL link index commit together; every changed cell uses CAS. */
export class PageRelationWriteRepository {
  constructor(private readonly execute: typeof db.sqlRaw = db.sqlRaw, private readonly commit: Commit = rqlite) {}

  private assert(p: Plan, text: string, values: unknown[] = []): void {
    // A failed assertion aborts the entire rqlite transaction, including earlier writes.
    p.guards.push([`INSERT INTO pages(id,owner_id) SELECT '!',NULL WHERE NOT (${text})`, ...values] as RqliteStatement);
  }

  private async column(id: string): Promise<Schema.PageColumn | null> {
    const [row] = await this.execute<Omit<Schema.PageColumn, 'data'> & {data: string}>({
      text: 'SELECT * FROM page_columns WHERE id=? AND deleted_at IS NULL', values: [id],
    }, 'query');
    return row ? {...row, data: JSON.parse(row.data || '{}') as Schema.PageColumnData} : null;
  }

  private async cell(pageId: string, columnId: string): Promise<Cell | null> {
    const [row] = await this.execute<Cell>({
      text: 'SELECT * FROM page_columns_values WHERE page_id=? AND page_column_id=?', values: [pageId, columnId],
    }, 'query');
    return row ?? null;
  }

  private columnGuard(p: Plan, column: Definition): void {
    this.assert(p, `EXISTS(SELECT 1 FROM page_columns WHERE id=? AND parent_id IS ? AND type=?
      AND name IS ? AND json(data)=json(?) AND deleted_at IS NULL)`,
    [column.id, column.parent_id, column.type, column.name, JSON.stringify(column.data)]);
  }

  private cellGuard(p: Plan, pageId: string, columnId: string, cell: Cell | null): void {
    this.assert(p, cell
      ? 'EXISTS(SELECT 1 FROM page_columns_values WHERE id=? AND page_id=? AND page_column_id=? AND data IS ?)'
      : 'NOT EXISTS(SELECT 1 FROM page_columns_values WHERE page_id=? AND page_column_id=?)',
    cell ? [cell.id, pageId, columnId, cell.data] : [pageId, columnId]);
  }

  private async access(p: Plan, pageId: string, column: Definition, userId: string, definition = false): Promise<void> {
    const guard = accessGuard('page', pageId, userId, 'write', 'update');
    const path = `$.columnLocks."${column.id}".userIds`;
    const text = `${guard.text} AND EXISTS(SELECT 1 FROM pages WHERE id=? AND deleted_at IS NULL)
      AND EXISTS(SELECT 1 FROM pages WHERE id=? AND deleted_at IS NULL AND (
        json_type(COALESCE(data,'{}'),?) IS NULL OR EXISTS(
          SELECT 1 FROM json_each(COALESCE(data,'{}'),?) WHERE value=?)))`;
    const values = [...guard.values, pageId, column.parent_id, path, path, userId];
    const rows = await this.execute({text: `SELECT 1 WHERE ${text}`, values}, 'query');
    if (!rows.length) throw new PageRelationError(403, 'Sem permissão para editar um dos lados da relação, ou propriedade bloqueada');
    this.assert(p, text, values);
    if (!definition) this.assert(p, 'EXISTS(SELECT 1 FROM page_edges WHERE parent_id=? AND child_id=?)', [column.parent_id, pageId]);
  }

  private limit(column: Definition, ids: string[]): void {
    if (ids.length > (column.data.relation?.cardinality === 'one' ? 1 : 250)) {
      throw new PageRelationError(409, column.data.relation?.cardinality === 'one'
        ? `A relação "${column.name ?? 'Relação'}" aceita somente uma página. Remova o vínculo anterior primeiro.`
        : 'A relação atingiu o limite de 250 páginas');
    }
  }

  private async definitionLimit(column: Definition): Promise<void> {
    if (column.data.relation?.cardinality !== 'one') return;
    const rows = await this.execute({
      text: `SELECT 1 FROM page_columns_values WHERE page_column_id=? AND json_valid(data)
        AND json_array_length(data,'$.value')>1 LIMIT 1`, values: [column.id],
    }, 'query');
    if (rows.length) throw new PageRelationError(409, 'Existem células com várias páginas. Ajuste os vínculos antes de limitar a relação a uma página.');
  }

  private writeCell(p: Plan, column: Definition, pageId: string, cell: Cell | null, ids: string[], removeEmpty = false): Cell {
    this.limit(column, ids);
    this.cellGuard(p, pageId, column.id, cell);
    const id = cell?.id ?? ulid(), data = encode(ids);
    if (removeEmpty && !ids.length && cell) {
      p.writes.push(['DELETE FROM page_relation_links WHERE source_cell_id=?', cell.id]);
      p.writes.push(['DELETE FROM page_columns_values WHERE id=?', cell.id]);
    } else if (cell) {
      p.writes.push([`UPDATE page_columns_values SET data=?,updated_at=${now} WHERE id=?`, data, id]);
    } else {
      p.writes.push(['INSERT INTO page_columns_values(id,page_id,page_column_id,data) VALUES(?,?,?,?)', id, pageId, column.id, data]);
    }
    p.pages.add(pageId);
    if (column.parent_id) p.pages.add(column.parent_id);
    return {...cell, id, page_id: pageId, page_column_id: column.id, data} as Cell;
  }

  private async run(p: Plan): Promise<void> {
    try {
      const results = await this.commit([...p.guards, ...p.writes, ...[...p.pages].map(pageActivityTouchStatement)], 'execute', {transaction: true});
      // Guards intentionally affect zero rows; deletions of an empty index may also be no-ops.
      if (!results.slice(p.guards.length, p.guards.length + p.writes.length).some(Boolean)) throw new Error('Relation transaction rejected');
    } catch (error) {
      if (error instanceof PageRelationError) throw error;
      throw new PageRelationError(409, 'A relação foi alterada ou um limite foi atingido. Atualize a página e tente novamente.');
    }
  }

  private async planWrite(column: Schema.PageColumn, pageId: string, ids: string[], userId: string, existing: Cell | null, removeEmpty = false, creating = false): Promise<{p: Plan; result: Cell}> {
    const p = plan(), config = column.data.relation;
    if (!config || !column.parent_id) throw new PageRelationError(400, 'Configuração de relação obrigatória');
    this.columnGuard(p, column);
    await this.access(p, creating ? column.parent_id : pageId, column, userId, creating);
    if (creating) this.assert(p, 'EXISTS(SELECT 1 FROM page_edges WHERE parent_id=? AND child_id=?)', [column.parent_id, pageId]);
    const previous = decode(existing);
    const changed = [...new Set([...previous, ...ids])].filter(id => previous.includes(id) !== ids.includes(id));
    const inverse = config.inverseColumnId ? await this.column(config.inverseColumnId) : null;
    if (config.inverseColumnId && (inverse?.type !== 'relation' || inverse.data.relation?.inverseColumnId !== column.id
      || inverse.parent_id !== config.targetDatabaseId || inverse.data.relation.targetDatabaseId !== column.parent_id)) {
      throw new PageRelationError(409, 'A propriedade inversa foi alterada. Reabra a configuração.');
    }
    if (inverse) this.columnGuard(p, inverse);
    for (const targetId of changed) {
      if (ids.includes(targetId)) {
        const read = accessGuard('page', targetId, userId, 'read', 'view');
        this.assert(p, `EXISTS(SELECT 1 FROM page_edges JOIN pages ON pages.id=child_id
          WHERE parent_id=? AND child_id=? AND pages.deleted_at IS NULL) AND ${read.text}`,
        [config.targetDatabaseId, targetId, ...read.values]);
      }
      if (!inverse) continue;
      await this.access(p, targetId, inverse, userId);
      const mirror = await this.cell(targetId, inverse.id);
      const oldIds = decode(mirror);
      const nextIds = ids.includes(targetId) ? [...new Set([...oldIds, pageId])] : oldIds.filter(id => id !== pageId);
      this.writeCell(p, inverse, targetId, mirror, nextIds);
    }
    const result = this.writeCell(p, column, pageId, existing, ids, removeEmpty);
    return {p, result};
  }

  /** Used inside the form transaction, after the new response page and edge exist. */
  async prepareCreate(column: Schema.PageColumn, pageId: string, ids: string[], userId: string): Promise<RqliteStatement[]> {
    const {p} = await this.planWrite(column, pageId, ids, userId, null, false, true);
    return [...p.guards, ...p.writes, ...[...p.pages].map(pageActivityTouchStatement)];
  }

  async write(column: Schema.PageColumn, pageId: string, ids: string[], userId: string, existing: Cell | null, removeEmpty = false): Promise<Cell> {
    const {p, result} = await this.planWrite(column, pageId, ids, userId, existing, removeEmpty);
    await this.run(p);
    return result;
  }

  private persistColumn(p: Plan, next: Definition, previous: Definition | null): void {
    if (previous) {
      this.columnGuard(p, previous);
      p.writes.push([`UPDATE page_columns SET name=?,type=?,data=?,updated_at=${now} WHERE id=?`,
        next.name, next.type, JSON.stringify(next.data), next.id]);
    } else {
      this.assert(p, 'NOT EXISTS(SELECT 1 FROM page_columns WHERE id=?)', [next.id]);
      p.writes.push(['INSERT INTO page_columns(id,name,type,parent_id,data) VALUES(?,?,?,?,?)',
        next.id, next.name, next.type, next.parent_id, JSON.stringify(next.data)]);
    }
    if (next.parent_id) p.pages.add(next.parent_id);
  }

  /** Enabling creates one explicit inverse property. Disabling preserves both sides as independent relations. */
  async saveDefinition(previous: Schema.PageColumn | null, input: Definition, request: Schema.RelationInput | null | undefined, userId: string): Promise<{column: Schema.PageColumn; inverse?: Schema.PageColumn; inverseCreated?: boolean}> {
    const p = plan(), next: Definition = {...input, data: {...input.data, relation: {...input.data.relation!}}};
    const config = next.data.relation!;
    if (!next.parent_id) throw new PageRelationError(400, 'Página da relação obrigatória');
    delete config.inverseName; delete config.inverseCardinality;
    await this.access(p, next.parent_id, next, userId, true);
    const previousPair = previous?.data.relation?.inverseColumnId;
    let inverse = previousPair ? await this.column(previousPair) : null;
    if (previousPair && (!inverse || inverse.type !== 'relation' || inverse.data.relation?.inverseColumnId !== next.id)) {
      throw new PageRelationError(409, 'A propriedade inversa não está disponível');
    }
    if (previousPair && previous?.data.relation?.targetDatabaseId !== config.targetDatabaseId) {
      throw new PageRelationError(409, 'Desative a relação bidirecional antes de alterar o destino');
    }
    const enabled = request?.bidirectional ?? Boolean(previousPair);
    if (enabled) {
      const inversePrevious = inverse;
      if (!inverse) {
        const siblings = await this.execute<{name: string | null; id: string; data: string}>({
          text: 'SELECT id,name,data FROM page_columns WHERE parent_id=? AND deleted_at IS NULL', values: [config.targetDatabaseId],
        }, 'query');
        const [parent] = await this.execute<{data: string}>({text: 'SELECT data FROM pages WHERE id=?', values: [config.targetDatabaseId]}, 'query');
        const [source] = await this.execute<{title: string | null}>({text: 'SELECT title FROM pages WHERE id=?', values: [next.parent_id]}, 'query');
        const name = allocateDuplicateLabel(request?.inverseName ?? source?.title ?? 'Relação',
          [...siblings.map(c => c.name), ...(config.targetDatabaseId === next.parent_id ? [next.name] : [])], 1);
        const reserved = collectReservedPublicKeys(siblings.map(c => ({id: c.id, label: c.name, publicKey: JSON.parse(c.data || '{}').publicKey})), 'coluna');
        collectPageColumnReservations(parent?.data ? JSON.parse(parent.data) : {}).forEach(key => reserved.add(key));
        if (config.targetDatabaseId === next.parent_id && next.data.publicKey) reserved.add(next.data.publicKey.key);
        inverse = {id: ulid(), name, type: 'relation', parent_id: config.targetDatabaseId, data: {
          publicKey: reconcilePublicKeyMetadata(name, 'coluna', null, reserved),
          relation: {version: 1, targetDatabaseId: next.parent_id, cardinality: request?.inverseCardinality ?? 'many', inverseColumnId: next.id},
        }} as Schema.PageColumn;
      } else {
        inverse = {...inverse, data: {...inverse.data, relation: {...inverse.data.relation!,
          ...(request?.inverseCardinality && {cardinality: request.inverseCardinality})}}};
        // Existing inverse names are edited through their own header to preserve public-key history.
      }
      config.inverseColumnId = inverse.id;
      await this.access(p, inverse.parent_id!, inverse, userId, true);
      await this.definitionLimit(inverse);
      this.persistColumn(p, inverse, inversePrevious);
      if (!inversePrevious) {
        const cells = await this.execute<Cell>({text: 'SELECT * FROM page_columns_values WHERE page_column_id=? ORDER BY id', values: [next.id]}, 'query');
        this.assert(p, '(SELECT COUNT(*) FROM page_columns_values WHERE page_column_id=?)=?', [next.id, cells.length]);
        const mirrors = new Map<string, string[]>();
        for (const cell of cells) {
          if (!cell.page_id) continue;
          this.cellGuard(p, cell.page_id, next.id, cell);
          for (const target of decode(cell)) mirrors.set(target, [...(mirrors.get(target) ?? []), cell.page_id]);
        }
        for (const [target, ids] of mirrors) {
          await this.access(p, target, inverse, userId);
          this.writeCell(p, inverse, target, null, ids);
        }
      }
    } else {
      delete config.inverseColumnId;
      if (inverse) {
        await this.access(p, inverse.parent_id!, inverse, userId, true);
        const independent = {...inverse, data: {...inverse.data, relation: {...inverse.data.relation!}}};
        delete independent.data.relation.inverseColumnId;
        this.persistColumn(p, independent, inverse);
      }
    }
    await this.definitionLimit(next);
    this.persistColumn(p, next, previous);
    await this.run(p);
    return {column: (await this.column(next.id))!,
      ...(inverse && {inverse: (await this.column(inverse.id))!, inverseCreated: !previousPair})};
  }
}

export default new PageRelationWriteRepository();
