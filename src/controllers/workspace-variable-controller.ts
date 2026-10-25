import variables, { WorkspaceVariableStore } from '@/repositories/workspace-variable-repository';
import workspaces from '@/repositories/workspace-repository';
import { isUlid } from '@/services/pages/views/page-view-parsers';
import { parseVariableInput } from '@/services/mentions/variable-input';
import type { WorkspaceMutationResult } from '@/controllers/types/workspace-controller.types';
import type { WorkspaceSummary } from '@/repositories/types/workspace-repository.types';

export class WorkspaceVariableController {
  constructor(private readonly store: WorkspaceVariableStore = variables) {}

  async set(workspaceId: string, userId: string, body: unknown): Promise<WorkspaceMutationResult<WorkspaceSummary>> {
    const input = parseVariableInput(body);
    if (!isUlid(workspaceId) || !input) {
      return { ok: false, reason: 'validation', message: 'Variável inválida' };
    }
    try {
      if (!await this.store.set(workspaceId, userId, input.key, input.value)) {
        return { ok: false, reason: 'forbidden', message: 'Acesso não permitido' };
      }
      const workspace = await workspaces.getForUser(workspaceId, userId);
      return workspace ? { ok: true, data: workspace }
        : { ok: false, reason: 'not_found', message: 'Workspace não encontrada' };
    } catch {
      return { ok: false, reason: 'server_error', message: 'Não foi possível salvar a variável' };
    }
  }
}
export default new WorkspaceVariableController();
