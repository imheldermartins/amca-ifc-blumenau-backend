import accessInviteStore from "@/db/repositories/access-invite-store";
import { hashOpaqueToken, isOpaqueToken } from "@/services/opaque-token";
import type {
  InviteContextPreview,
  InviteTokenPreview,
  InviteTokenStore,
  RegistrationInviteResolution,
} from "@/services/invitations/types/invite-token-service.types";

const INVITE_TOKEN_PREFIX = "cubs_invite_v1_";

/**
 * Fronteira única para resolver e consumir tokens de convite.
 *
 * Controllers não conhecem hashes nem persistência; fluxos de onboarding que
 * já guardaram o id do convite também passam por esta fronteira para aceitá-lo.
 */
export class InviteTokenService {
  public constructor(private readonly store: InviteTokenStore = accessInviteStore) {}

  public async preview(token: unknown): Promise<InviteTokenPreview> {
    try {
      const invite = await this.pendingInvite(token);
      if (!invite) return { valid: false };
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
      };
    } catch {
      return { valid: false };
    }
  }

  public async resolveForRegistration(
    token: unknown,
    email: string,
  ): Promise<RegistrationInviteResolution> {
    const invite = await this.pendingInvite(token);
    const canonicalEmail = email.trim().toLowerCase();
    if (!invite || (invite.recipientEmail
      && invite.recipientEmail.trim().toLowerCase() !== canonicalEmail)) {
      return { valid: false };
    }
    return { valid: true, inviteId: invite.id };
  }

  public async previewById(inviteId: string): Promise<InviteContextPreview | null> {
    const invite = await this.store.getById(inviteId);
    return invite ? {
      scopeType: invite.scopeType,
      scopeId: invite.scopeId,
      scopeName: invite.scopeName,
      roleName: invite.roleName,
      authorName: invite.authorName,
    } : null;
  }

  public async accept(token: unknown, userId: string): Promise<boolean> {
    try {
      const invite = await this.pendingInvite(token);
      return Boolean(invite && await this.store.acceptById(invite.id, userId));
    } catch {
      return false;
    }
  }

  public async acceptById(inviteId: string, userId: string): Promise<boolean> {
    try {
      return await this.store.acceptById(inviteId, userId);
    } catch {
      return false;
    }
  }

  private async pendingInvite(token: unknown) {
    if (!isOpaqueToken(token, INVITE_TOKEN_PREFIX)) return null;
    const invite = await this.store.getByTokenHash(hashOpaqueToken(token));
    return invite?.status === "pending" ? invite : null;
  }
}

export default new InviteTokenService();
