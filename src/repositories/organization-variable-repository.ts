import db from '@models/index';
import { accessGuard } from '@/repositories/scoped-access-repository';

export class OrganizationVariableStore {
  constructor(private readonly execute: typeof db.sqlRaw = db.sqlRaw) {}
  async set(id: string, actor: string, key: string, value: string | null): Promise<boolean> {
    const guard = accessGuard('organization', id, actor, 'write', 'update');
    const rows = await this.execute<{ id: string }>({
      text: `UPDATE organizations SET data = json_patch(COALESCE(data, '{}'), json_object(?, ?)),
        updated_at = CURRENT_TIMESTAMP WHERE id = ? AND ${guard.text} RETURNING id`,
      values: [key, value, id, ...guard.values],
    }, 'request');
    return rows.length === 1;
  }
}
export default new OrganizationVariableStore();
