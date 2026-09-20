import type { WorkspaceSummary } from "@db/workspace-store";
import type { Schema } from "@/models/schemas/index";
import type { TokenPair } from "@/services/auth/types/jwt.types";

export interface RegisterInput {
  email: string;
  name: string;
  inviteToken?: string;
  returnTo?: string;
  password?: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export type RegisterResult =
  | { ok: true; verificationRequired: true; email: string; notificationPending: boolean }
  | { ok: false; reason: "validation" | "invalid_invite" | "email_taken" | "too_soon" | "failed" };

export type VerificationCompleteResult =
  | { ok: true; user: Schema.User; workspace: WorkspaceSummary; tokens: TokenPair; inviteAccepted: boolean | null }
  | { ok: false; reason: "validation" | "invalid_token" | "failed" };

export interface LoginResult {
  user: Schema.User;
  tokens: TokenPair;
}
