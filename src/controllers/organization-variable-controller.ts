import variables, { OrganizationVariableStore } from '@/repositories/organization-variable-repository';
import organizations from '@/repositories/organization-repository';
import { isUlid } from '@/services/pages/views/page-view-parsers';
import { parseVariableInput } from '@/services/mentions/variable-input';
import type { OrganizationMutationResult } from '@/controllers/types/organization-controller.types';
import type { OrganizationSummary } from '@/repositories/types/organization-repository.types';

export class OrganizationVariableController {
  constructor(private readonly store: OrganizationVariableStore = variables) {}
  async set(id: string, actor: string, body: unknown): Promise<OrganizationMutationResult<OrganizationSummary>> {
    const input = parseVariableInput(body);
    if (!isUlid(id) || !input) return { ok: false, reason: 'validation', message: 'Variável inválida' };
    try {
      if (!await this.store.set(id, actor, input.key, input.value)) return { ok: false, reason: 'forbidden', message: 'Acesso não permitido' };
      const organization = await organizations.getForUser(id, actor);
      return organization ? { ok: true, data: organization } : { ok: false, reason: 'not_found', message: 'Organização não encontrada' };
    } catch { return { ok: false, reason: 'server_error', message: 'Não foi possível salvar a variável' }; }
  }
}
export default new OrganizationVariableController();
