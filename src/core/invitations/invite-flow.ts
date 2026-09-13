import { ulid } from 'ulid';
import accessInviteStore, { type InviteRecord } from '@db/access-invite-store';
import roleStore from '@db/role-store';
import scopedAccess from '@db/scoped-access-store';
import { SystemRoleFactory } from '@db/system-role-factory';
import { canDelegate, type AccessScope } from '@core/auth/permissions';
import { SmtpService } from '@core/mail/smtp-service';
import { accessInviteEmail } from '@core/mail/access-invite-email';
import accountVerification from '@/services/account-verification';
import { createOpaqueToken, hashOpaqueToken, isOpaqueToken, opaqueTokenHint } from '@/services/opaque-token';

export interface SendInviteInput {
  scopeId: string;
  actorId: string;
  roleId: string | null | undefined;
  recipientEmail?: string | null;
  expiresAt: string | null;
  acceptanceLimit: number | null;
}

export type SendInviteResult =
  | { ok: true; invite: InviteRecord; inviteUrl: string | null; notificationPending: boolean }
  | { ok: false; reason: 'forbidden' | 'invalid_role' | 'already_member' | 'failed' };

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

    const origin = process.env.APP_PUBLIC_URL;
    const inviteUrl = origin
      ? new URL(`/pt-br/invite/${encodeURIComponent(token)}`, origin).toString()
      : null;
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
      await smtp.send(accessInviteEmail({
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

const flows: Record<AccessScope, InviteFlow> = {
  organization: new InviteOrganization(),
  workspace: new InviteWorkspace(),
  page: new InvitePage(),
};

export function inviteFlow(scope: AccessScope): InviteFlow {
  return flows[scope];
}
