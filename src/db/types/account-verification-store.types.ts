export interface VerificationContext {
  kind: "native" | "invite";
  returnTo?: string;
}

export interface VerificationRecord {
  id: string;
  userId: string;
  name: string | null;
  email: string;
  inviteId: string | null;
  context: VerificationContext;
  expiresAt: string;
  lastSentAt: string;
}

export type StartVerificationResult =
  | { ok: true; verificationId: string; userId: string }
  | { ok: false; reason: "already_verified" | "too_soon" | "failed" };
