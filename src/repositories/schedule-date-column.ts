import {rqlite} from '@/db/client-db';
import {accessGuard} from '@/repositories/scoped-access-repository';

/** Agenda's default is a column identity; names and cell values never select it again. */
export function scheduleDateColumnId(data: unknown): string | undefined {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
  const schedule = (data as Record<string, unknown>).schedule;
  if (!schedule || typeof schedule !== 'object' || Array.isArray(schedule)) return undefined;
  const id = (schedule as Record<string, unknown>).dateColumnId;
  return id == null ? undefined : typeof id === 'string' ? id : '';
}

export async function bindScheduleDateColumn(parentId: string, columnId: string, userId: string): Promise<void> {
  const guard = accessGuard('page', parentId, userId, 'write', 'update');
  const result = await rqlite([
    [`UPDATE pages SET data=json_set(COALESCE(data,'{}'),'$.schedule.dateColumnId',?),
      updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id=? AND deleted_at IS NULL
        AND (json_extract(data,'$.schedule.dateColumnId') IS NULL OR json_extract(data,'$.schedule.dateColumnId')=?)
        AND EXISTS(SELECT 1 FROM page_columns WHERE id=? AND parent_id=? AND type='date' AND deleted_at IS NULL)
        AND ${guard.text}`, columnId, parentId, columnId, columnId, parentId, ...guard.values],
    ["INSERT INTO pages(id,owner_id) SELECT '!',NULL WHERE changes()=0"],
  ], 'execute', {transaction: true});
  if (result[0] !== true) throw new Error('Não foi possível vincular a propriedade da Agenda.');
}
