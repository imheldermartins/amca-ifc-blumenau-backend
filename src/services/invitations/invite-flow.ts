import { ulid } from 'ulid';
import accessInviteStore from '@/repositories/access-invite-repository';
import roleStore from '@/repositories/role-repository';
import scopedAccess from '@/repositories/scoped-access-repository';
import { SystemRoleFactory } from '@/repositories/system-role-factory';
import { canDelegate, type AccessScope } from '@/services/auth/permissions';
import { SmtpService } from '@/services/mail/smtp-service';
import { accessInviteEmail } from '@/services/mail/access-invite-email';
import accountVerification from '@/services/account-verification';
import { createOpaqueToken, hashOpaqueToken, isOpaqueToken, opaqueTokenHint } from '@/services/opaque-token';
import type { SendInviteInput, SendInviteResult } from '@/services/invitations/types/invite-flow.types';

/** Contrato comum dos convites; subclasses fixam apenas o escopo. */
export abstract class InviteFlow {
  protected abstract readonly scope: AccessScope;

  async sendInvite(input: SendInviteInput): Promise<SendInviteResult> {
    const grant = await scopedAccess.get(this.scope, input.scopeId, input.actorId);
    if (!grant || !await scopedAccess.can(this.scope, input.scopeId, input.actorId, 'write', 'add_members')) {
      return { ok: false, reason: 'forbidden' };
    }
    const roleId = input.roleId || await SystemRoleFactory.ensureDefault(this.scope, input.scopeId);
    if (!roleId) return { ok: false, reason: 'invalid_role' };
    const role = await roleStore.get(this.scope, input.scopeId, roleId);
    if (!role || !canDelegate(grant, role.roles)) return { ok: false, reason: 'invalid_role' };

    const recipientEmail = input.recipientEmail?.trim().toLowerCase() || null;
    if (recipientEmail) {
      const target = await accessInviteStore.exactEmail(recipientEmail, this.scope, input.scopeId);
      if (target.isMember || target.user?.id === grant.ownerId) return { ok: false, reason: 'already_member' };
    }
    const token = createOpaqueToken('cubs_invite_v1_');
    const origin = process.env.APP_PUBLIC_URL?.trim();
    let inviteUrl: string | null = null;
    try {
      inviteUrl = origin
        ? new URL(`/pt-br/invite/${encodeURIComponent(token)}`, origin).toString()
        : null;
    } catch {
      inviteUrl = null;
    }
    // Um convite genérico só pode ser consumido pelo link; sem URL ele seria
    // persistido sem qualquer forma de entrega ou recuperação do token.
    if (!recipientEmail && !inviteUrl) return { ok: false, reason: 'failed' };

    const id = ulid();
    const created = await accessInviteStore.create({
      id,
      tokenHash: hashOpaqueToken(token),
      tokenHint: opaqueTokenHint(token),
      scope: this.scope,
      scopeId: input.scopeId,
      roleId,
      recipientEmail,
      authorId: input.actorId,
      expiresAt: input.expiresAt,
      acceptanceLimit: recipientEmail ? 1 : input.acceptanceLimit,
    });
    if (!created) return { ok: false, reason: 'failed' };
    const invite = await accessInviteStore.getById(id);
    if (!invite) return { ok: false, reason: 'failed' };

    if (!recipientEmail) {
      return { ok: true, invite, inviteUrl, notificationPending: false };
    }

    const target = await accessInviteStore.exactEmail(recipientEmail, this.scope, input.scopeId);
    if (!target.user?.verified) {
      const verification = await accountVerification.begin({
        name: target.user?.name ?? null,
        email: recipientEmail,
        inviteId: id,
        context: { kind: 'invite' },
        bypassCooldown: true,
      });
      if (verification.ok) {
        return { ok: true, invite, inviteUrl: null, notificationPending: verification.notificationPending };
      }
      if (verification.reason !== 'already_verified') {
        return { ok: true, invite, inviteUrl: null, notificationPending: true };
      }
    }

    let smtp: SmtpService | undefined;
    try {
      if (!inviteUrl) throw new Error('APP_PUBLIC_URL não configurada');
      smtp = SmtpService.fromEnvironment();
      await smtp.send(accessInviteEmail.create({
        recipientEmail,
        scopeType: { organization: 'organização', workspace: 'workspace', page: 'página' }[this.scope],
        scopeName: invite.scopeName,
        authorName: invite.authorName,
        roleName: invite.roleName,
        inviteUrl,
        expiresAt: invite.expiresAt,
      }));
      await accessInviteStore.markNotified(id);
      return { ok: true, invite: (await accessInviteStore.getById(id)) ?? invite, inviteUrl: null, notificationPending: false };
    } catch {
      return { ok: true, invite, inviteUrl: null, notificationPending: true };
    } finally {
      smtp?.close();
    }
  }

  async accept(token: unknown, userId: string): Promise<boolean> {
    if (!isOpaqueToken(token, 'cubs_invite_v1_')) return false;
    const invite = await accessInviteStore.getByTokenHash(hashOpaqueToken(token));
    return Boolean(invite && invite.scopeType === this.scope
      && await accessInviteStore.acceptById(invite.id, userId));
  }
}

export class InviteOrganization extends InviteFlow { protected readonly scope = 'organization' as const; }
export class InviteWorkspace extends InviteFlow { protected readonly scope = 'workspace' as const; }
export class InvitePage extends InviteFlow { protected readonly scope = 'page' as const; }

export class InviteFlowRegistry {
  private readonly flows: Record<AccessScope, InviteFlow> = {
    organization: new InviteOrganization(),
    workspace: new InviteWorkspace(),
    page: new InvitePage(),
  };

  public for(scope: AccessScope): InviteFlow {
    return this.flows[scope];
  }
}

export const inviteFlowRegistry = new InviteFlowRegistry();
