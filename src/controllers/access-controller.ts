import access, { ULID_RE } from '@db/scoped-access-store';
import roleStore from '@db/role-store';
import requestStore from '@db/membership-request-store';
import { allows, canDelegate, parsePermissions, ROLE_MANAGEMENT_PERMISSION, type AccessScope } from '@core/auth/permissions';
import { SmtpService } from '@core/mail/smtp-service';
import { membershipRequestEmail } from '@core/mail/membership-request-email';
import accessInviteStore from '@db/access-invite-store';
import { inviteFlow } from '@core/invitations/invite-flow';

export type AccessResult<T = unknown> = { ok: true; data: T } | { ok: false; reason: 'validation' | 'forbidden' | 'conflict' | 'server_error'; message: string };
const denied = { ok: false, reason: 'forbidden', message: 'Acesso não permitido' } as const;
const invalid = { ok: false, reason: 'validation', message: 'Dados inválidos' } as const;
const conflict = { ok: false, reason: 'conflict', message: 'A operação não foi concluída. Atualize as informações e confira as permissões.' } as const;
class AccessController {
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
      if (!allows(grant, 'read', 'members') && !allows(grant, 'write', 'promote_members') && !allows(grant, 'write', 'add_members')) return denied;
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
    return this.run(async () => {
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
        || (body.roleId !== undefined && (typeof body.roleId !== 'string' || !ULID_RE.test(body.roleId)))) return invalid;
      const result = await inviteFlow(scope).sendInvite({
        scopeId: id,
        actorId: actor,
        roleId: body.roleId as string | undefined,
        recipientEmail: email,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        acceptanceLimit: 1,
      });
      if (!result.ok) return result.reason === 'forbidden' ? denied
        : result.reason === 'already_member' ? conflict : invalid;
      return { ok: true, data: result };
    });
  }
  removeMember(scope: AccessScope, id: string, actor: string, target: string) {
    return this.run(async () => await roleStore.removeMember(scope, id, actor, target) ? { ok: true, data: { saved: true } } : denied);
  }
  requests(scope: AccessScope, id: string, actor: string) {
    return this.run(async () => ({ ok: true, data: await requestStore.list(scope, id, actor) }));
  }
  request(scope: AccessScope, id: string, actor: string) {
    return this.run(async () => {
      const result = await requestStore.create(scope, id, actor);
      if (!result) return conflict;
      let notificationPending = false;
      if (result.created) {
        let smtp: SmtpService | undefined;
        try {
          const origin = process.env.APP_PUBLIC_URL;
          if (!origin) throw new Error('APP_PUBLIC_URL não configurada');
          smtp = SmtpService.fromEnvironment();
          const context = await requestStore.notificationContext(scope, id, actor);
          if (!context.requester || !context.approvers.length) throw new Error('Destinatários indisponíveis');
          for (const person of context.approvers) {
            try {
              // Uma revogação antes do envio também remove o destinatário.
              if (!await access.can(scope, id, person.id, 'write', 'add_members')) continue;
              await smtp.send(membershipRequestEmail({
                recipient: { name: person.name || person.email, email: person.email },
                requester: { name: context.requester.name || context.requester.email, email: context.requester.email },
                scopeName: context.scopeName, scopeType: { organization: 'Organização', workspace: 'Workspace', page: 'Página' }[scope] as 'Organização' | 'Workspace' | 'Página',
                reviewUrl: new URL('/pt-br/access/' + scope + '/' + id + '/requests/' + result.request.id, origin).toString(),
              }));
              await requestStore.recordNotification(scope, result.request.id, person.email);
            } catch { notificationPending = true; }
          }
        } catch { notificationPending = true; }
        finally { smtp?.close(); }
      }
      return { ok: true, data: { request: result.request, notificationPending } };
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
    return this.run(async () => {
      if (!await access.can(scope, id, actor, 'write', 'add_members')) return denied;
      const email = typeof emailValue === 'string' ? emailValue.trim().toLowerCase() : '';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return invalid;
      return { ok: true, data: await accessInviteStore.exactEmail(email, scope, id) };
    });
  }

  invites(scope: AccessScope, id: string, actor: string) {
    return this.run(async () => {
      const grant = await access.get(scope, id, actor);
      if (!allows(grant, 'read', 'members') && !allows(grant, 'write', 'add_members')) return denied;
      return { ok: true, data: await accessInviteStore.list(scope, id) };
    });
  }

  createInvite(scope: AccessScope, id: string, actor: string, body: Record<string, unknown>) {
    return this.run(async () => {
      const recipientEmail = typeof body.recipientEmail === 'string'
        ? body.recipientEmail.trim().toLowerCase()
        : null;
      if (recipientEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) return invalid;
      if (body.roleId !== undefined && body.roleId !== null
        && (typeof body.roleId !== 'string' || !ULID_RE.test(body.roleId))) return invalid;
      const expiresIn = body.expiresIn ?? '24h';
      if (!['24h', '7d', 'never'].includes(expiresIn as string)) return invalid;
      const acceptanceLimit = body.acceptanceLimit === undefined || body.acceptanceLimit === null
        ? null
        : Number(body.acceptanceLimit);
      if (acceptanceLimit !== null && (!Number.isInteger(acceptanceLimit) || acceptanceLimit < 1 || acceptanceLimit > 100_000)) return invalid;
      const expiresAt = expiresIn === 'never' ? null
        : new Date(Date.now() + (expiresIn === '7d' ? 7 : 1) * 24 * 60 * 60 * 1000).toISOString();
      const result = await inviteFlow(scope).sendInvite({
        scopeId: id,
        actorId: actor,
        roleId: body.roleId as string | null | undefined,
        recipientEmail,
        expiresAt,
        acceptanceLimit,
      });
      if (!result.ok) return result.reason === 'forbidden' ? denied
        : result.reason === 'already_member' ? conflict : invalid;
      return { ok: true, data: result };
    });
  }

  removeInvite(scope: AccessScope, id: string, actor: string, inviteId: string) {
    return this.run(async () => {
      if (!ULID_RE.test(inviteId)) return invalid;
      if (!await access.can(scope, id, actor, 'write', 'add_members')) return denied;
      return await accessInviteStore.remove(inviteId, scope, id)
        ? { ok: true, data: { expired: true } } : conflict;
    });
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
