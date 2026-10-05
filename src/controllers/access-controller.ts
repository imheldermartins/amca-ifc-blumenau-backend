import access from '@/repositories/scoped-access-repository';
import roleStore from '@/repositories/role-repository';
import requestStore from '@/repositories/membership-request-repository';
import { allows, canDelegate, parsePermissions, ROLE_MANAGEMENT_PERMISSION, type AccessScope } from '@/services/auth/permissions';
import inviteApplicationService from '@/services/invitations/invite-application-service';
import membershipRequestService from '@/services/membership-requests/membership-request-service';
import type { AccessResult } from '@/controllers/types/access-controller.types';
import { ULID_RE } from '@/utils/ulid';
export type { AccessResult } from '@/controllers/types/access-controller.types';

const denied = { ok: false, reason: 'forbidden', message: 'Acesso não permitido' } as const;
const invalid = { ok: false, reason: 'validation', message: 'Dados inválidos' } as const;
const conflict = { ok: false, reason: 'conflict', message: 'A operação não foi concluída. Atualize as informações e confira as permissões.' } as const;
export class AccessController {
  async run(operation: () => Promise<AccessResult>): Promise<AccessResult> {
    try { return await operation(); } catch (error) {
      console.error('Falha na operação de acesso', error instanceof Error ? error.name : 'Unknown');
      return { ok: false, reason: 'server_error', message: 'Erro no servidor' };
    }
  }
  current(scope: AccessScope, id: string, actor: string) {
    return this.run(async () => {
      const grant = await access.get(scope, id, actor);
      return allows(grant, 'read', 'view') ? { ok: true, data: grant } : denied;
    });
  }
  roles(scope: AccessScope, id: string, actor: string) {
    return this.run(async () => {
      const grant = await access.get(scope, id, actor);
      if (!allows(grant, 'read', 'roles') && !['add_members', 'promote_members', ROLE_MANAGEMENT_PERMISSION[scope]].some(action => allows(grant, 'write', action))) return denied;
      return { ok: true, data: await roleStore.list(scope, id) };
    });
  }
  saveRole(scope: AccessScope, id: string, actor: string, body: Record<string, unknown>, roleId?: string) {
    return this.run(async () => {
      const grant = await access.get(scope, id, actor);
      if (!grant || !allows(grant, 'write', ROLE_MANAGEMENT_PERMISSION[scope])) return denied;
      const roles = parsePermissions(scope, body.roles);
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!roles || !name || name.length > 120 || (roleId && (!ULID_RE.test(roleId) || typeof body.expectedUpdatedAt !== 'string'))) return invalid;
      if (!canDelegate(grant, roles)) return denied;
      const saved = await roleStore.save(scope, id, actor, { name, roles, id: roleId, expectedUpdatedAt: body.expectedUpdatedAt as string | undefined });
      return saved ? { ok: true, data: saved } : conflict;
    });
  }
  members(scope: AccessScope, id: string, actor: string, target?: string) {
    return this.run(async () => {
      const grant = await access.get(scope, id, actor);
      if (!allows(grant, 'read', 'members') && !['promote_members', 'add_members', 'remove_members'].some(action => allows(grant, 'write', action))) return denied;
      const members = await roleStore.members(scope, id);
      if (!target) return { ok: true, data: members };
      const member = members.find(row => row.id === target || row.membershipId === target);
      if (!member) return invalid;
      return { ok: true, data: { ...member, access: await access.get(scope, id, member.id) } };
    });
  }
  assign(scope: AccessScope, id: string, actor: string, target: string, roleId: unknown) {
    return this.run(async () => {
      if (!ULID_RE.test(target) || typeof roleId !== 'string' || !ULID_RE.test(roleId)) return invalid;
      return await roleStore.assign(scope, id, actor, target, roleId) ? { ok: true, data: { saved: true } } : denied;
    });
  }
  addMember(scope: AccessScope, id: string, actor: string, body: Record<string, unknown>) {
    return this.run(() => inviteApplicationService.inviteMember(scope, id, actor, body));
  }
  removeMember(scope: AccessScope, id: string, actor: string, target: string) {
    return this.run(async () => {
      if (!ULID_RE.test(target)) return invalid;
      return await roleStore.removeMember(scope, id, actor, target) ? { ok: true, data: { saved: true } } : denied;
    });
  }
  requests(scope: AccessScope, id: string, actor: string) {
    return this.run(async () => ({ ok: true, data: await requestStore.list(scope, id, actor) }));
  }
  request(scope: AccessScope, id: string, actor: string) {
    return this.run(async () => {
      const result = await membershipRequestService.create(scope, id, actor);
      if (!result) return conflict;
      return { ok: true, data: result };
    });
  }
  decide(scope: AccessScope, id: string, actor: string, requestId: string, body: Record<string, unknown>) {
    return this.run(async () => {
      if (!ULID_RE.test(requestId) || (body.decision !== 'accepted' && body.decision !== 'rejected') ||
        (body.decision === 'accepted' && (typeof body.roleId !== 'string' || !ULID_RE.test(body.roleId)))) return invalid;
      const saved = await requestStore.decide(scope, id, requestId, actor, body.decision, body.roleId as string | undefined);
      return saved ? { ok: true, data: { saved: true } } : conflict;
    });
  }

  searchEmail(scope: AccessScope, id: string, actor: string, emailValue: unknown) {
    return this.run(() => inviteApplicationService.searchRecipient(scope, id, actor, emailValue));
  }

  invites(scope: AccessScope, id: string, actor: string) {
    return this.run(() => inviteApplicationService.list(scope, id, actor));
  }

  createInvite(scope: AccessScope, id: string, actor: string, body: Record<string, unknown>) {
    return this.run(() => inviteApplicationService.createInvite(scope, id, actor, body));
  }

  removeInvite(scope: AccessScope, id: string, actor: string, inviteId: string) {
    return this.run(() => inviteApplicationService.revoke(scope, id, actor, inviteId));
  }

  removeRole(scope: AccessScope, id: string, actor: string, roleId: string) {
    return this.run(async () => {
      if (!ULID_RE.test(roleId)) return invalid;
      return await roleStore.remove(scope, id, actor, roleId)
        ? { ok: true, data: { deleted: true } } : conflict;
    });
  }

  organizationWorkspaceRoles(scope: AccessScope, id: string, actor: string) {
    return this.run(async () => {
      if (scope !== 'workspace') return invalid;
      const grant = await access.get(scope, id, actor);
      if (!allows(grant, 'read', 'roles') && !allows(grant, 'write', ROLE_MANAGEMENT_PERMISSION.workspace)) return denied;
      return { ok: true, data: await roleStore.listOrganizationWorkspaceRoles(id) };
    });
  }

  copyWorkspaceRole(scope: AccessScope, id: string, actor: string, sourceRoleId: string) {
    return this.run(async () => {
      if (scope !== 'workspace' || !ULID_RE.test(sourceRoleId)) return invalid;
      const copied = await roleStore.copyWorkspaceRole(id, sourceRoleId, actor);
      return copied ? { ok: true, data: copied } : conflict;
    });
  }
}
export default new AccessController();
