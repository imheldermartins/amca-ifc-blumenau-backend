import bcrypt from 'bcryptjs';
import { ulid } from 'ulid';
import accountVerificationStore, { type VerificationContext } from '@db/account-verification-store';
import accessInviteStore from '@db/access-invite-store';
import authOnboardingStore from '@db/auth-onboarding-store';
import workspaceStore, { type WorkspaceSummary } from '@db/workspace-store';
import { accountVerificationEmail } from '@core/mail/account-verification-email';
import { SmtpService } from '@core/mail/smtp-service';
import { createOpaqueToken, hashOpaqueToken, isOpaqueToken, opaqueTokenHint } from './opaque-token.js';
import type { Schema } from '@/models/schemas/index';

const VERIFICATION_LIFETIME_MS = 24 * 60 * 60 * 1000;
const SALT_ROUNDS = 10;

export interface BeginVerificationInput {
  name: string | null;
  email: string;
  inviteId?: string | null;
  context: VerificationContext;
  bypassCooldown?: boolean;
}

export type BeginVerificationResult =
  | { ok: true; email: string; notificationPending: boolean }
  | { ok: false; reason: 'already_verified' | 'too_soon' | 'failed' };

export interface VerificationPreview {
  valid: boolean;
  email?: string;
  name?: string | null;
  invite?: { scopeType: string; scopeId: string; scopeName: string; roleName: string; authorName: string } | null;
}

/** Orquestra token, SMTP e ativação sem expor o hash ou o segredo persistido. */
export class AccountVerificationService {
  async begin(input: BeginVerificationInput): Promise<BeginVerificationResult> {
    const previous = input.context.kind === 'native' && !input.inviteId
      ? await accountVerificationStore.findPendingByEmail(input.email)
      : null;
    const effective = previous?.inviteId
      ? { ...input, inviteId: previous.inviteId, context: previous.context }
      : input;
    const token = createOpaqueToken('cubs_verify_v1_');
    const started = await accountVerificationStore.start({
      ...effective,
      tokenHash: hashOpaqueToken(token),
      tokenHint: opaqueTokenHint(token),
      expiresAt: new Date(Date.now() + VERIFICATION_LIFETIME_MS).toISOString(),
    });
    if (!started.ok) return started;

    let smtp: SmtpService | undefined;
    try {
      const origin = process.env.APP_PUBLIC_URL;
      if (!origin) throw new Error('APP_PUBLIC_URL não configurada');
      smtp = SmtpService.fromEnvironment();
      const verificationUrl = new URL(`/pt-br/verify-email/${encodeURIComponent(token)}`, origin);
      if (effective.context.returnTo) verificationUrl.searchParams.set('returnTo', effective.context.returnTo);
      await smtp.send(accountVerificationEmail({ name: effective.name, email: effective.email, verificationUrl: verificationUrl.toString() }));
      return { ok: true, email: effective.email, notificationPending: false };
    } catch {
      return { ok: true, email: effective.email, notificationPending: true };
    } finally {
      smtp?.close();
    }
  }

  async preview(token: unknown): Promise<VerificationPreview> {
    if (!isOpaqueToken(token, 'cubs_verify_v1_')) return { valid: false };
    const record = await accountVerificationStore.preview(hashOpaqueToken(token));
    if (!record) return { valid: false };
    const invite = record.inviteId ? await accessInviteStore.getById(record.inviteId) : null;
    return {
      valid: true,
      email: record.email,
      name: record.name,
      invite: invite ? {
        scopeType: invite.scopeType,
        scopeId: invite.scopeId,
        scopeName: invite.scopeName,
        roleName: invite.roleName,
        authorName: invite.authorName,
      } : null,
    };
  }

  async resend(email: string): Promise<BeginVerificationResult> {
    const pending = await accountVerificationStore.findPendingByEmail(email);
    // Resposta uniforme: um endereço desconhecido não vira um oráculo de contas.
    if (!pending) return { ok: true, email, notificationPending: false };
    return this.begin({
      name: pending.name,
      email: pending.email,
      inviteId: pending.inviteId,
      context: pending.context,
    });
  }

  async complete(token: unknown, password: unknown, name: unknown): Promise<{
    user: Schema.UserCredentials;
    workspace: WorkspaceSummary;
    inviteAccepted: boolean | null;
  } | null> {
    if (!isOpaqueToken(token, 'cubs_verify_v1_') || typeof password !== 'string'
      || password.length < 6 || Buffer.byteLength(password, 'utf8') > 72) return null;
    const preview = await accountVerificationStore.preview(hashOpaqueToken(token));
    if (!preview) return null;
    const cleanName = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : null;
    if ((!preview.name && !cleanName) || (cleanName && cleanName.length > 120)) return null;
    const completed = await accountVerificationStore.complete({
      tokenHash: hashOpaqueToken(token),
      passwordHash: await bcrypt.hash(password, SALT_ROUNDS),
      name: cleanName,
      workspaceId: ulid(),
      membershipId: ulid(),
    });
    if (!completed) return null;
    let inviteAccepted: boolean | null = null;
    if (completed.inviteId) {
      try { inviteAccepted = await accessInviteStore.acceptById(completed.inviteId, completed.userId); }
      catch { inviteAccepted = false; }
    }
    const user = await authOnboardingStore.findUserById(completed.userId);
    const workspace = await workspaceStore.getForUser(completed.workspaceId, completed.userId);
    if (!user || !workspace) return null;
    return { user, workspace, inviteAccepted };
  }
}

export default new AccountVerificationService();
