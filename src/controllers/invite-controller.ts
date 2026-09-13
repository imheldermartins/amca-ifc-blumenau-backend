import accessInviteStore from '@db/access-invite-store';
import { inviteFlow } from '@core/invitations/invite-flow';
import { hashOpaqueToken, isOpaqueToken } from '@/services/opaque-token';

class InviteController {
  async preview(token: unknown) {
    try {
      if (!isOpaqueToken(token, 'cubs_invite_v1_')) return { valid: false } as const;
      const invite = await accessInviteStore.getByTokenHash(hashOpaqueToken(token));
      if (!invite || invite.status !== 'pending') return { valid: false } as const;
      return {
        valid: true,
        scopeType: invite.scopeType,
        scopeId: invite.scopeId,
        scopeName: invite.scopeName,
        roleName: invite.roleName,
        authorName: invite.authorName,
        recipientEmail: invite.recipientEmail,
        expiresAt: invite.expiresAt,
        acceptanceLimit: invite.acceptanceLimit,
        acceptanceCount: invite.acceptanceCount,
      } as const;
    } catch {
      return { valid: false } as const;
    }
  }

  async accept(token: unknown, userId: string): Promise<boolean> {
    try {
      if (!isOpaqueToken(token, 'cubs_invite_v1_')) return false;
      const invite = await accessInviteStore.getByTokenHash(hashOpaqueToken(token));
      return Boolean(invite && await inviteFlow(invite.scopeType).accept(token, userId));
    } catch {
      return false;
    }
  }
}

export default new InviteController();
