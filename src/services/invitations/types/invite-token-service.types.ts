import type { InviteRecord } from "@/repositories/access-invite-repository";

export type InviteTokenPreview =
  | { valid: false }
  | {
      valid: true;
      scopeType: InviteRecord["scopeType"];
      scopeId: string;
      scopeName: string;
      roleName: string;
      authorName: string;
      recipientEmail: string | null;
      expiresAt: string | null;
      acceptanceLimit: number | null;
      acceptanceCount: number;
    };

export type InviteContextPreview = Pick<
  Extract<InviteTokenPreview, { valid: true }>,
  "scopeType" | "scopeId" | "scopeName" | "roleName" | "authorName"
>;

export type RegistrationInviteResolution =
  | { valid: true; inviteId: string }
  | { valid: false };

export interface InviteTokenStore {
  getById(inviteId: string): Promise<InviteRecord | null>;
  getByTokenHash(tokenHash: string): Promise<InviteRecord | null>;
  acceptById(inviteId: string, userId: string): Promise<boolean>;
}
