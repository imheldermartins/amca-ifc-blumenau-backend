import type { InviteRecord } from "@db/access-invite-store";

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
  | { ok: false; reason: "forbidden" | "invalid_role" | "already_member" | "failed" };
