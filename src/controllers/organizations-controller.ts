import { ulid } from 'ulid';
import organizationStore, { type OrganizationSummary } from '@/repositories/organization-repository';
import workspaceStore, { type WorkspaceSummary } from '@/repositories/workspace-repository';
import { ULID_RE } from '@/utils/ulid';
import type { OrganizationMutationResult } from '@/controllers/types/organization-controller.types';
export type { OrganizationMutationResult } from '@/controllers/types/organization-controller.types';

const failure = { ok: false, reason: 'conflict', message: 'A operação não foi concluída. Confira sua sessão e suas permissões.' } as const;
export class OrganizationsController {
  async listForUser(userId: string) { try { return await organizationStore.listForUser(userId); } catch { return null; } }
  async getForUser(id: string, userId: string) { try { return await organizationStore.getForUser(id, userId); } catch { return null; } }
  async create(userId: string, input: { name?: unknown }): Promise<OrganizationMutationResult<OrganizationSummary>> {
    const name = this.cleanName(input.name);
    if (!name) return { ok: false, reason: 'validation', message: 'Informe o nome da organização.' };
    try {
      const id = ulid();
      if (!await organizationStore.create({ organizationId: id, organizationName: name, ownerId: userId, membershipId: ulid() })) return failure;
      const organization = await organizationStore.getForUser(id, userId);
      return organization ? { ok: true, data: organization } : failure;
    } catch { return failure; }
  }
  async update(id: string, userId: string, input: { name?: unknown }): Promise<OrganizationMutationResult<OrganizationSummary>> {
    const name = this.cleanName(input.name);
    if (!name || !ULID_RE.test(id)) return { ok: false, reason: 'validation', message: 'Nome inválido.' };
    try {
      if (!await organizationStore.update(id, userId, name)) return failure;
      const organization = await organizationStore.getForUser(id, userId);
      return organization ? { ok: true, data: organization } : failure;
    } catch { return failure; }
  }
  async catalog(id: string, userId: string) { try { return await organizationStore.catalog(id, userId); } catch { return null; } }
  async linkWorkspace(organizationId: string, workspaceId: string, userId: string): Promise<OrganizationMutationResult<WorkspaceSummary>> {
    if (![organizationId, workspaceId].every(id => ULID_RE.test(id))) return { ok: false, reason: 'validation', message: 'Identificador inválido.' };
    try {
      if (!await organizationStore.linkWorkspace(organizationId, workspaceId, userId)) return failure;
      const workspace = await workspaceStore.getForUser(workspaceId, userId);
      return workspace ? { ok: true, data: workspace } : failure;
    } catch { return failure; }
  }

  private cleanName(name: unknown): string | null {
    if (typeof name !== 'string') return null;
    const value = name.trim().replace(/\s+/g, ' ');
    return value.length > 0 && value.length <= 120 ? value : null;
  }
}
export default new OrganizationsController();
