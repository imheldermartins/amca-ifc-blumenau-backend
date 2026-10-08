import bcrypt from 'bcryptjs';
import { ulid } from 'ulid';
import accountVerificationStore from '@/repositories/account-verification-repository';
import authOnboardingStore from '@/repositories/auth-onboarding-repository';
import workspaceStore, { type WorkspaceSummary } from '@/repositories/workspace-repository';
import inviteTokenService from '@/services/invitations/invite-token-service';
import { accountVerificationEmail } from '@/services/mail/account-verification-email';
import { SendEmail } from '@/services/mail/send-email';
import { createOpaqueToken, hashOpaqueToken, isOpaqueToken, opaqueTokenHint } from './opaque-token.js';
import type { Schema } from '@/db/schemas/index';
import type { BeginVerificationInput, BeginVerificationResult, VerificationPreview } from '@/services/types/account-verification.types';
export type { BeginVerificationInput, BeginVerificationResult, VerificationPreview } from '@/services/types/account-verification.types';

const VERIFICATION_LIFETIME_MS = 24 * 60 * 60 * 1000;
const SALT_ROUNDS = 10;

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

    let emailSender: SendEmail | undefined;
    try {
      const origin = process.env.APP_PUBLIC_URL;
      if (!origin) throw new Error('APP_PUBLIC_URL não configurada');
      emailSender = SendEmail.fromEnvironment();
      const verificationUrl = new URL(`/pt-br/verify-email/${encodeURIComponent(token)}`, origin);
      if (effective.context.returnTo) verificationUrl.searchParams.set('returnTo', effective.context.returnTo);
      const email = accountVerificationEmail.create({
        name: effective.name,
        email: effective.email,
        verificationUrl: verificationUrl.toString(),
      });
      await emailSender.send({
        to: { name: effective.name?.trim() || effective.email, email: effective.email },
        ...email,
      });
      return { ok: true, email: effective.email, notificationPending: false };
    } catch {
      return { ok: true, email: effective.email, notificationPending: true };
    } finally {
      emailSender?.close();
    }
  }

  async preview(token: unknown): Promise<VerificationPreview> {
    if (!isOpaqueToken(token, 'cubs_verify_v1_')) return { valid: false };
    const record = await accountVerificationStore.preview(hashOpaqueToken(token));
    if (!record) return { valid: false };
    const invite = record.inviteId ? await inviteTokenService.previewById(record.inviteId) : null;
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
      inviteAccepted = await inviteTokenService.acceptById(completed.inviteId, completed.userId);
    }
    const user = await authOnboardingStore.findUserById(completed.userId);
    const workspace = await workspaceStore.getForUser(completed.workspaceId, completed.userId);
    if (!user || !workspace) return null;
    return { user, workspace, inviteAccepted };
  }
}

export default new AccountVerificationService();
