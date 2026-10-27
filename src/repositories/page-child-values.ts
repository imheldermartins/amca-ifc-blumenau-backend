import db from '@models/index';
import type {Schema} from '@/db/schemas/index';
import {VALUE_CODECS} from '@/services/value-codec';
import relations from '@/repositories/page-relation-repository';
import relationWrites from '@/repositories/page-relation-write-repository';
import locks from '@/repositories/column-lock-repository';
import {pageCellUpsertStatement} from '@/repositories/page-cell-statements';
import {accessGuard} from '@/repositories/scoped-access-repository';

export class PageChildInputError extends Error {
  constructor(message: string, public readonly status: 400 | 403 | 409 = 400) { super(message); }
}

export function assertChildInput(input: {title?: unknown; values?: unknown}): void {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new PageChildInputError('Página inválida');
  if (input.title !== undefined && input.title !== null && typeof input.title !== 'string') {
    throw new PageChildInputError('Título inválido');
  }
  if (input.values !== undefined && (!input.values || typeof input.values !== 'object' || Array.isArray(input.values))) {
    throw new PageChildInputError('Propriedades inválidas');
  }
}

/** Failing SQL guards abort the surrounding page/edge/value transaction. */
export const childAssertion = (text: string, values: unknown[]): RqliteStatement =>
  [`INSERT INTO pages(id,owner_id) SELECT '!',NULL WHERE NOT (${text})`, ...values] as RqliteStatement;

export async function prepareChildValues(parentId: string, childId: string, userId: string, values: Record<string, unknown>, titleProvided: boolean): Promise<RqliteStatement[]> {
  const columns = await db.pageColumns.findAll({parent_id: parentId} as LookupsConfig<Schema.PageColumn>) ?? [];
  const definitions = new Map<string, Schema.PageColumn>(columns.map(column => [column.id, column]));
  const statements: RqliteStatement[] = [];
  const create = accessGuard('page', parentId, userId, 'write', 'create');
  statements.push(childAssertion(create.text, create.values));
  const lockKeys = [...Object.keys(values), ...(titleProvided ? ['title'] : [])];
  for (const key of lockKeys) {
    if (!await locks.canMutate(parentId as NonEmptyString, key, userId as NonEmptyString)) throw new PageChildInputError('Propriedade bloqueada', 403);
    const path = `$.columnLocks."${key}".userIds`;
    // json paths are bound too: request keys never become SQL identifiers.
    statements.push(childAssertion(`EXISTS(SELECT 1 FROM pages WHERE id=? AND deleted_at IS NULL AND (
      json_type(COALESCE(data,'{}'),?) IS NULL OR EXISTS(
        SELECT 1 FROM json_each(COALESCE(data,'{}'),?) WHERE value=?)))`, [parentId, path, path, userId]));
  }
  for (const [id, raw] of Object.entries(values)) {
    const column = definitions.get(id);
    if (!column || column.deleted_at != null || column.parent_id !== parentId) throw new PageChildInputError('Propriedade não pertence à base');
    if (['formula', 'extract_as', 'flow'].includes(column.type)) throw new PageChildInputError('Propriedade somente leitura');
    statements.push(childAssertion(`EXISTS(SELECT 1 FROM page_columns WHERE id=? AND parent_id=? AND type=? AND json(COALESCE(data,'{}'))=json(?) AND deleted_at IS NULL)`,
      [id, parentId, column.type, JSON.stringify(column.data ?? {})]));
    if (raw == null) continue;
    try {
      if (column.type === 'relation') {
        const requested = VALUE_CODECS.relation.validate(raw, column) as string[];
        const targets = await relations.prepareRelationTargets(column, childId, requested, userId);
        statements.push(...await relationWrites.prepareCreate(column, childId, targets, userId));
      } else {
        const codec = VALUE_CODECS[column.type];
        statements.push(pageCellUpsertStatement(childId, id, codec.encode(codec.validate(raw, column))));
      }
    } catch (error) {
      if (error instanceof Error && 'status' in error) throw new PageChildInputError(error.message, (error as {status: 400 | 403 | 409}).status);
      throw new PageChildInputError(error instanceof Error ? error.message : 'Valor inválido');
    }
  }
  return statements;
}
