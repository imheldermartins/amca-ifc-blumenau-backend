import {generateKeyBetween} from 'fractional-indexing';
import {rqlite} from '@/db/client-db';
import {accessGuard} from '@/repositories/scoped-access-repository';
import access from '@/repositories/scoped-access-repository';
import {pageActivityTouchStatement} from '@/repositories/page-activity';
import {pageCellUpsertStatement} from '@/repositories/page-cell-statements';
import {parseColumnLocks} from '@/repositories/column-lock-repository';
import {BOARD_UNASSIGNED} from '@/services/pages/views/page-board-config';
import type {PageViewRowMoveInput, PageViewRowMoveResult} from '@/services/pages/views/page-view-query-contract';
import {isActivePageView, isJsonRecord} from '@/services/pages/views/page-view-parsers';
import {VALUE_CODECS} from '@/services/value-codec';
import type {Schema} from '@/db/schemas/index';
import {checkedOrderWrite, compactViewRowRanks, ensurePageViewRowOrder, incrementOrderRevisionStatement,
  readOrderRevision, rowOrderPath, withPageRowOrderLock} from '@/repositories/page-view-row-order';

export class PageViewRowMoveError extends Error {
  constructor(public readonly reason: 'not_found' | 'validation' | 'forbidden' | 'conflict' | 'server_error',
    message: string, public readonly confirmed?: PageViewRowMoveResult) { super(message); }
}
interface MovingRow {row_id: string; rank: string; cell_data: string | null}
interface ParentState {data: string}

const rawOption = (data: string | null): string | null => {
  try { const value: unknown = data ? JSON.parse(data).value : null; return typeof value === 'string' ? value : null; }
  catch { return null; }
};

function selectColumn(view: Record<string, unknown>, columns: Schema.PageColumn[]): Schema.PageColumn | undefined {
  const config = isJsonRecord(view.board) ? view.board : {};
  if (config.selectColumnId !== undefined) return columns.find((column) => column.id === config.selectColumnId && column.type === 'select');
  return columns.find((column) => column.type === 'select');
}

export class PageViewRowMoveStore {
  private async currentConfirmed(parentId: string, viewId: string, rowId: string, userId: string): Promise<PageViewRowMoveResult | undefined> {
    if (!await access.can('page',parentId,userId,'read','view') || !await access.can('page',rowId,userId,'read','view')) return undefined;
    const [parents, columns] = await rqlite<ParentState | Schema.PageColumn>([
      ['SELECT data FROM pages WHERE id=? AND deleted_at IS NULL',parentId],
      ['SELECT * FROM page_columns WHERE parent_id=? AND deleted_at IS NULL ORDER BY id',parentId],
    ],'query');
    if (!parents?.[0]) return undefined;
    const raw=(parents[0] as ParentState).data;
    const data: unknown = typeof raw==='string' ? JSON.parse(raw) : raw;
    const view=isJsonRecord(data) ? data[viewId] : undefined;
    if (!isActivePageView(view)) return undefined;
    const parsed=(columns ?? []).map(value=>{
      const column=value as Schema.PageColumn;
      return {...column,data:typeof column.data==='string' ? JSON.parse(column.data) as Schema.PageColumnData : column.data};
    });
    const column=view.view==='board' ? selectColumn(view,parsed) : undefined;
    const [cells] = column ? await rqlite<{data:string}>([['SELECT data FROM page_columns_values WHERE page_id=? AND page_column_id=?',rowId,column.id]],'query') : [[]];
    return {rowId,orderRevision:readOrderRevision(view),...(column&&{selectColumnId:column.id,optionId:rawOption(cells?.[0]?.data ?? null)})};
  }
  async move(parentId: string, viewId: string, userId: string, input: PageViewRowMoveInput): Promise<PageViewRowMoveResult> {
    if (!await access.can('page', parentId, userId, 'write', 'update')) {
      throw new PageViewRowMoveError('forbidden', 'Sem permissão para alterar a ordem desta view');
    }
    if (!await access.can('page', input.rowId, userId, 'read', 'view')) {
      throw new PageViewRowMoveError('not_found', 'Página não encontrada');
    }
    return withPageRowOrderLock(parentId, async () => {
      await ensurePageViewRowOrder(parentId, viewId, true);
      const [parents, columns, positions] = await rqlite<ParentState | Schema.PageColumn | MovingRow>([
        ['SELECT data FROM pages WHERE id = ? AND deleted_at IS NULL', parentId],
        ['SELECT * FROM page_columns WHERE parent_id = ? AND deleted_at IS NULL ORDER BY id', parentId],
        [`SELECT position.row_id, position.rank, value.data AS cell_data FROM page_view_row_order position
          JOIN pages row ON row.id = position.row_id AND row.deleted_at IS NULL
          JOIN page_edges edge ON edge.child_id = row.id AND edge.parent_id = position.parent_id
          LEFT JOIN page_columns_values value ON value.page_id = row.id
           AND value.page_column_id = COALESCE(json_extract((SELECT data FROM pages WHERE id = position.parent_id),
            '$."' || position.view_id || '".board.selectColumnId'), '')
          WHERE position.parent_id = ? AND position.view_id = ? AND position.row_id = ?`, parentId, viewId, input.rowId],
      ], 'query');
      if (!parents?.[0] || !positions?.[0]) throw new PageViewRowMoveError('not_found', 'Página ou view não encontrada');
      const parentData: unknown = typeof (parents[0] as ParentState).data === 'string'
        ? JSON.parse((parents[0] as ParentState).data) : (parents[0] as ParentState).data;
      const view = isJsonRecord(parentData) ? parentData[viewId] : undefined;
      if (!isActivePageView(view)) throw new PageViewRowMoveError('not_found', 'View não encontrada');
      const revision = readOrderRevision(view);
      const parsedColumns = (columns ?? []).map((value) => {
        const column = value as Schema.PageColumn;
        return {...column, data: typeof column.data === 'string' ? JSON.parse(column.data) as Schema.PageColumnData : column.data};
      });
      const column = view.view === 'board' ? selectColumn(view, parsedColumns) : undefined;
      const transferRequested = Object.prototype.hasOwnProperty.call(input, 'targetOptionId');
      if (transferRequested && (!column || view.view !== 'board')) {
        throw new PageViewRowMoveError('validation', 'A transferência exige uma view Board com coluna select válida');
      }
      const [rowCells] = column ? await rqlite<{data: string}>([[
        'SELECT data FROM page_columns_values WHERE page_id = ? AND page_column_id = ?', input.rowId, column.id,
      ]], 'query') : [[]];
      const previousOptionId = rawOption(rowCells?.[0]?.data ?? null);
      const confirmed = {rowId: input.rowId, orderRevision: revision,
        ...(column && {selectColumnId: column.id, optionId: previousOptionId})};
      if (input.expectedOrderRevision !== revision) throw new PageViewRowMoveError('conflict', 'A ordem foi alterada por outra pessoa', confirmed);
      if (!await access.can('page', parentId, userId, 'write', 'update')
        || !await access.can('page', input.rowId, userId, 'read', 'view')) {
        throw new PageViewRowMoveError('forbidden', 'Sem permissão para mover esta página');
      }
      if (transferRequested && input.previousOptionId !== previousOptionId) {
        throw new PageViewRowMoveError('conflict', 'O valor da página foi alterado por outra pessoa', confirmed);
      }
      const assignmentChanges = transferRequested && previousOptionId !== input.targetOptionId;
      if (transferRequested && input.targetOptionId !== null) {
        try { VALUE_CODECS.select.validate(input.targetOptionId, column!); }
        catch (error) { throw new PageViewRowMoveError('validation', error instanceof Error ? error.message : 'Opção inválida'); }
      }
      if (assignmentChanges && (!await access.can('page', input.rowId, userId, 'write', 'update')
        || (parseColumnLocks(parentData)[column!.id]?.userIds.includes(userId) === false))) {
        throw new PageViewRowMoveError('forbidden', 'Coluna bloqueada ou sem permissão para edição');
      }
      const sourceOptionKey = column?.data?.options?.some((option) => option.id === previousOptionId)
        ? previousOptionId : BOARD_UNASSIGNED;
      const destinationOptionKey = transferRequested ? input.targetOptionId ?? BOARD_UNASSIGNED : sourceOptionKey;

      const canonicalOption = "CASE WHEN json_valid(cell.data) THEN json_extract(cell.data, '$.value') ELSE NULL END";
      const optionPredicate = column
        ? `AND CASE WHEN EXISTS (SELECT 1 FROM json_each(?) option
            WHERE json_extract(option.value, '$.id') = (${canonicalOption}))
          THEN (${canonicalOption}) ELSE ? END = ?` : '';
      const optionValues: unknown[] = column ? [JSON.stringify(column.data?.options ?? []), BOARD_UNASSIGNED, destinationOptionKey] : [];
      const cellJoin = column ? 'LEFT JOIN page_columns_values cell ON cell.page_id = position.row_id AND cell.page_column_id = ?' : '';
      const cellJoinValues = column ? [column.id] : [];
      const orderedSql = `SELECT position.row_id, position.rank, ${column ? 'cell.data' : 'NULL'} AS cell_data FROM page_view_row_order position
        JOIN pages row ON row.id = position.row_id AND row.deleted_at IS NULL ${cellJoin}
        WHERE position.parent_id = ? AND position.view_id = ? AND position.row_id <> ? ${optionPredicate}`;
      const orderedValues = [...cellJoinValues, parentId, viewId, input.rowId, ...optionValues];
      let anchor: MovingRow | undefined, lower: MovingRow | undefined, upper: MovingRow | undefined;
      const anchorId = input.beforeId ?? input.afterId;
      if (anchorId) {
        const [anchors] = await rqlite<MovingRow>([[`${orderedSql} AND position.row_id = ?`, ...orderedValues, anchorId]], 'query');
        anchor = anchors?.[0];
        if (!anchor || !await access.can('page', anchorId, userId, 'read', 'view')) {
          throw new PageViewRowMoveError('conflict', 'A posição de destino mudou; atualize a visualização', confirmed);
        }
        const before = !!input.beforeId;
        const [neighbors] = await rqlite<MovingRow>([[`${orderedSql}
          AND (position.rank, position.row_id) ${before ? '<' : '>'} (?, ?)
          ORDER BY position.rank COLLATE BINARY ${before ? 'DESC' : 'ASC'}, position.row_id ${before ? 'DESC' : 'ASC'} LIMIT 1`,
        ...orderedValues, anchor.rank, anchor.row_id]], 'query');
        if (before) { lower = neighbors?.[0]; upper = anchor; }
        else { lower = anchor; upper = neighbors?.[0]; }
      } else {
        const start = input.boundary === 'start';
        const [ends] = await rqlite<MovingRow>([[`${orderedSql}
          ORDER BY position.rank COLLATE BINARY ${start ? 'ASC' : 'DESC'}, position.row_id ${start ? 'ASC' : 'DESC'} LIMIT 1`,
        ...orderedValues]], 'query');
        if (start) upper = ends?.[0]; else lower = ends?.[0];
      }
      // Neighbors from other groups and filtered-out pages remain untouched.
      // An empty Board still uses the complete global tail rather than inventing an unpersisted slot.
      if (!lower && !upper && column) {
        const [tails] = await rqlite<MovingRow>([[`SELECT row_id, rank FROM page_view_row_order
          WHERE parent_id = ? AND view_id = ? AND row_id <> ? ORDER BY rank COLLATE BINARY DESC, row_id DESC LIMIT 1`,
        parentId, viewId, input.rowId]], 'query');
        lower = tails?.[0];
      }
      // Allocate in a globally empty gap. A Board-only gap may contain ranks belonging
      // to other Boards; reusing one would break a later select edit that joins them.
      const insertBefore=Boolean(input.beforeId) || input.boundary==='start';
      const boundary=insertBefore && upper ? upper : lower;
      if (boundary) {
        const direction=insertBefore && upper ? '<' : '>';
        const [adjacent] = await rqlite<MovingRow>([[`SELECT row_id,rank FROM page_view_row_order
          WHERE parent_id=? AND view_id=? AND row_id<>? AND (rank,row_id) ${direction} (?,?)
          ORDER BY rank COLLATE BINARY ${direction==='<' ? 'DESC' : 'ASC'},row_id ${direction==='<' ? 'DESC' : 'ASC'} LIMIT 1`,
        parentId,viewId,input.rowId,boundary.rank,boundary.row_id]],'query');
        if (direction==='<') lower=adjacent?.[0]; else upper=adjacent?.[0];
      }
      if (lower && upper && lower.rank===upper.rank) {
        await compactViewRowRanks(parentId,viewId,revision);
        throw new PageViewRowMoveError('conflict','A ordem foi reorganizada; tente novamente',{...confirmed,orderRevision:revision+1});
      }
      const rank = generateKeyBetween(lower?.rank ?? null, upper?.rank ?? null);
      if (rank.length > 128) {
        await compactViewRowRanks(parentId, viewId, revision);
        throw new PageViewRowMoveError('conflict', 'A ordem foi reorganizada; tente novamente', {...confirmed, orderRevision: revision + 1});
      }
      const parentGuard = accessGuard('page', parentId, userId, 'write', 'update');
      const rowGuard = accessGuard('page', input.rowId, userId, assignmentChanges ? 'write' : 'read', assignmentChanges ? 'update' : 'view');
      const revisionWrite = incrementOrderRevisionStatement(parentId, viewId, revision);
      const [baseSql, ...baseValues] = revisionWrite;
      let guardSql = `${baseSql} AND ${parentGuard.text} AND ${rowGuard.text}
        AND EXISTS (SELECT 1 FROM page_edges edge JOIN pages row ON row.id = edge.child_id AND row.deleted_at IS NULL
          WHERE edge.parent_id = ? AND edge.child_id = ?)`;
      const guardValues: unknown[] = [...baseValues, ...parentGuard.values, ...rowGuard.values, parentId, input.rowId];
      if (column) {
        guardSql += ' AND EXISTS (SELECT 1 FROM page_columns WHERE id = ? AND parent_id = ? AND deleted_at IS NULL AND type = \'select\')';
        guardValues.push(column.id, parentId);
        guardSql += ` AND json_extract(data, ?) = 'board' AND json_extract(data, ?) IS ?`;
        guardValues.push(rowOrderPath(viewId, 'view'), rowOrderPath(viewId, 'board.selectColumnId'),
          isJsonRecord(view.board) ? view.board.selectColumnId ?? null : null);
      }
      if (column) {
        guardSql += ` AND COALESCE((SELECT data FROM page_columns_values WHERE page_id = ? AND page_column_id = ?), '') = ?`;
        guardValues.push(input.rowId, column.id, rowCells?.[0]?.data ?? '');
      }
      if (assignmentChanges) {
        const lockPath = `$.columnLocks."${column!.id}".userIds`;
        guardSql += ` AND (COALESCE(json_type(data, ?), '') <> 'array'
          OR EXISTS (SELECT 1 FROM json_each(data, ?) allowed WHERE allowed.value = ?))`;
        guardValues.push(lockPath, lockPath, userId);
        if (input.targetOptionId !== null) {
          guardSql += ` AND EXISTS (SELECT 1 FROM page_columns active, json_each(active.data, '$.options') option
            WHERE active.id = ? AND json_extract(option.value, '$.id') = ?)`;
          guardValues.push(column!.id, input.targetOptionId);
        }
      }
      if (anchor) {
        const anchorGuard = accessGuard('page', anchor.row_id, userId, 'read', 'view');
        guardSql += ` AND ${anchorGuard.text} AND EXISTS (SELECT 1 FROM page_view_row_order position JOIN pages anchor ON anchor.id = position.row_id
          WHERE position.parent_id = ? AND position.view_id = ? AND position.row_id = ? AND position.rank = ? AND anchor.deleted_at IS NULL)`;
        guardValues.push(...anchorGuard.values, parentId, viewId, anchor.row_id, anchor.rank);
        if (column) {
          guardSql += ` AND COALESCE((SELECT data FROM page_columns_values WHERE page_id = ? AND page_column_id = ?), '') = ?`;
          guardValues.push(anchor.row_id, column.id, anchor.cell_data ?? '');
        }
      }
      const writes: RqliteStatement[] = [[guardSql, ...guardValues]];
      if (assignmentChanges) {
        writes.push(input.targetOptionId === null
          ? ['DELETE FROM page_columns_values WHERE page_id = ? AND page_column_id = ?', input.rowId, column!.id]
          : pageCellUpsertStatement(input.rowId, column!.id, VALUE_CODECS.select.encode(input.targetOptionId)));
      }
      writes.push(['UPDATE page_view_row_order SET rank = ?, updated_at = CURRENT_TIMESTAMP WHERE parent_id = ? AND view_id = ? AND row_id = ?',
        rank, parentId, viewId, input.rowId], pageActivityTouchStatement(parentId));
      try {
        await rqlite(writes.flatMap(checkedOrderWrite), 'execute', {transaction: true});
      } catch {
        let current: PageViewRowMoveResult | undefined;
        try { current=await this.currentConfirmed(parentId,viewId,input.rowId,userId); } catch { /* A later refresh will reconcile an unavailable database. */ }
        throw new PageViewRowMoveError('conflict', 'A página, a permissão ou a posição mudou durante o movimento', current);
      }
      return {rowId: input.rowId, orderRevision: revision + 1,
        ...(column && {selectColumnId: column.id, optionId: assignmentChanges ? input.targetOptionId : previousOptionId})};
    });
  }
}

export default new PageViewRowMoveStore();
