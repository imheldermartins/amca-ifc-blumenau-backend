import db from '@models/index';
import { accessGuard } from '@/repositories/scoped-access-repository';

export class WorkspaceVariableStore {
  public constructor(private readonly execute: typeof db.sqlRaw = db.sqlRaw) {}

  async set(workspaceId: string, userId: string, key: string, value: string | null): Promise<boolean> {
    const guard = accessGuard('workspace', workspaceId, userId, 'write', 'update');
    const rows = await this.execute<{ id: string }>({
      // Merge one literal key atomically. Null removes the variable; no JSON
      // path interpolation and no replacement of the rest of workspace.data.
      text: `UPDATE workspaces SET data = json_patch(COALESCE(data, '{}'), json_object(?, ?)),
        updated_at = CURRENT_TIMESTAMP WHERE id = ? AND ${guard.text} RETURNING id`,
      values: [key, value, workspaceId, ...guard.values],
    }, 'request');
    return rows.length === 1;
  }
}
export default new WorkspaceVariableStore();
