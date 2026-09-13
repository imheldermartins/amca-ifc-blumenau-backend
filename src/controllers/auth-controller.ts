import { Model } from '@/core/db/model';
import bcrypt from 'bcryptjs';
import type { Schema } from '@/models/schemas/index';
import jwtService, { type TokenPair } from '@core/auth/jwt-service';
import authOnboardingStore from '@db/auth-onboarding-store';
import accessInviteStore from '@db/access-invite-store';
import type { WorkspaceSummary } from '@db/workspace-store';
import accountVerification, { type BeginVerificationResult, type VerificationPreview } from '@/services/account-verification';
import { hashOpaqueToken, isOpaqueToken } from '@/services/opaque-token';

const MAX_NAME_LENGTH = 120;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normalizeEmail = (value: string): string => value.trim().toLowerCase();

export interface RegisterInput {
  email: string;
  name: string;
  inviteToken?: string;
  returnTo?: string;
  /** Compatibilidade de chamada: a senha só é usada após o clique do e-mail. */
  password?: string;
}

export interface LoginInput { email: string; password: string }

export type RegisterResult =
  | { ok: true; verificationRequired: true; email: string; notificationPending: boolean }
  | { ok: false; reason: 'validation' | 'invalid_invite' | 'email_taken' | 'too_soon' | 'failed' };

export type VerificationCompleteResult =
  | { ok: true; user: Schema.User; workspace: WorkspaceSummary; tokens: TokenPair; inviteAccepted: boolean | null }
  | { ok: false; reason: 'validation' | 'invalid_token' | 'failed' };

export type LoginResult = { user: Schema.User; tokens: TokenPair };

/** Cadastro em duas etapas: identidade pendente por e-mail e senha somente após o clique. */
class AuthController {
  private readonly users = new Model<Schema.UserCredentials>('users');

  public async register(input: RegisterInput): Promise<RegisterResult> {
    const values = this.cleanIdentity(input);
    if (!values) return { ok: false, reason: 'validation' };
    try {
      const existing = await authOnboardingStore.findUserByCanonicalEmail(values.email);
      if (existing?.email_verified_at) return { ok: false, reason: 'email_taken' };
      let inviteId: string | null = null;
      if (input.inviteToken !== undefined) {
        if (!isOpaqueToken(input.inviteToken, 'cubs_invite_v1_')) return { ok: false, reason: 'invalid_invite' };
        const invite = await accessInviteStore.getByTokenHash(hashOpaqueToken(input.inviteToken));
        if (!invite || invite.status !== 'pending'
          || (invite.recipientEmail && invite.recipientEmail !== values.email)) {
          return { ok: false, reason: 'invalid_invite' };
        }
        inviteId = invite.id;
      }
      const returnTo = this.cleanReturnTo(input.returnTo);
      return this.mapBegin(await accountVerification.begin({
        name: values.name,
        email: values.email,
        inviteId,
        context: inviteId
          ? { kind: 'invite' }
          : { kind: 'native', ...(returnTo ? { returnTo } : {}) },
      }));
    } catch (error) {
      this.log(error);
      return { ok: false, reason: 'failed' };
    }
  }

  public previewVerification(token: unknown): Promise<VerificationPreview> {
    return accountVerification.preview(token);
  }

  public async resendVerification(email: unknown): Promise<RegisterResult> {
    const normalized = typeof email === 'string' ? normalizeEmail(email) : '';
    if (!normalized || normalized.length > 254 || !EMAIL_PATTERN.test(normalized)) {
      return { ok: false, reason: 'validation' };
    }
    return this.mapBegin(await accountVerification.resend(normalized));
  }

  public async completeVerification(token: unknown, password: unknown, name: unknown): Promise<VerificationCompleteResult> {
    try {
      const completed = await accountVerification.complete(token, password, name);
      if (!completed) return { ok: false, reason: 'invalid_token' };
      return {
        ok: true,
        user: this.sanitize(completed.user),
        workspace: completed.workspace,
        tokens: jwtService.issueTokenPair({ sub: completed.user.id }, completed.user.token_version ?? 0),
        inviteAccepted: completed.inviteAccepted,
      };
    } catch (error) {
      this.log(error);
      return { ok: false, reason: 'failed' };
    }
  }

  public async login({ email, password }: LoginInput): Promise<LoginResult | null> {
    try {
      if (typeof email !== 'string' || typeof password !== 'string') return null;
      const user = await authOnboardingStore.findUserByCanonicalEmail(normalizeEmail(email));
      if (!user?.password_hash || !user.email_verified_at) return null;
      if (!await bcrypt.compare(password, user.password_hash)) return null;
      return {
        user: this.sanitize(user),
        tokens: jwtService.issueTokenPair({ sub: user.id }, user.token_version ?? 0),
      };
    } catch (error) {
      this.log(error);
      return null;
    }
  }

  public async me(userId: string): Promise<Schema.User | null> {
    try {
      const user = await this.users.find({ id: userId } as LookupValues<Schema.UserCredentials>);
      return user?.email_verified_at ? this.sanitize(user) : null;
    } catch (error) {
      this.log(error);
      return null;
    }
  }

  public async refresh(refreshToken: string): Promise<TokenPair | null> {
    try {
      const { sub, tv } = jwtService.verifyRefreshToken(refreshToken);
      const user = await this.users.find({ id: sub } as LookupValues<Schema.UserCredentials>);
      if (!user?.email_verified_at || (tv ?? 0) !== (user.token_version ?? 0)) return null;
      return jwtService.issueTokenPair({ sub }, user.token_version ?? 0);
    } catch { return null; }
  }

  public async revoke(refreshToken: string): Promise<void> {
    try {
      const { sub } = jwtService.verifyRefreshToken(refreshToken);
      const user = await this.users.find({ id: sub } as LookupValues<Schema.UserCredentials>);
      if (!user) return;
      await this.users.update(
        { token_version: (user.token_version ?? 0) + 1 } as UpdateValues<Schema.UserCredentials>,
        { id: sub } as LookupValues<Schema.UserCredentials>,
      );
    } catch { /* logout idempotente */ }
  }

  private sanitize(user: Schema.UserCredentials): Schema.User {
    const { password_hash, token_version, ...safe } = user;
    return safe;
  }

  private cleanIdentity(input: Pick<RegisterInput, 'name' | 'email'>): { name: string; email: string } | null {
    if (typeof input.name !== 'string' || typeof input.email !== 'string') return null;
    const name = input.name.trim().replace(/\s+/g, ' ');
    const email = normalizeEmail(input.email);
    if (!name || name.length > MAX_NAME_LENGTH || !email || email.length > 254 || !EMAIL_PATTERN.test(email)) return null;
    return { name, email };
  }

  private cleanReturnTo(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    return /^\/[a-z]{2}-[a-z]{2}\/organizations\/new$/i.test(value) ? value : null;
  }

  private mapBegin(result: BeginVerificationResult): RegisterResult {
    if (!result.ok) {
      if (result.reason === 'already_verified') return { ok: false, reason: 'email_taken' };
      return { ok: false, reason: result.reason };
    }
    return {
      ok: true,
      verificationRequired: true,
      email: result.email,
      notificationPending: result.notificationPending,
    };
  }

  private log(error: unknown): void {
    if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
  }
}

export default new AuthController();
