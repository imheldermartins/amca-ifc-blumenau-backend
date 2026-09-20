import type { VerificationContext } from "@db/account-verification-store";

export interface BeginVerificationInput {
  name: string | null;
  email: string;
  inviteId?: string | null;
  context: VerificationContext;
  bypassCooldown?: boolean;
}

export type BeginVerificationResult =
  | { ok: true; email: string; notificationPending: boolean }
  | { ok: false; reason: "already_verified" | "too_soon" | "failed" };

export interface VerificationPreview {
  valid: boolean;
  email?: string;
  name?: string | null;
  invite?: {
    scopeType: string;
    scopeId: string;
    scopeName: string;
    roleName: string;
    authorName: string;
  } | null;
}
