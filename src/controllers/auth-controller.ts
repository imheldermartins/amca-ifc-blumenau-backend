import bcrypt from "bcryptjs";
import { ulid } from "ulid";
import { Model } from "@/core/db/model";
import type { Schema } from "@/models/schemas/index";
import jwtService, { type TokenPair } from "@core/auth/jwt-service";
import authOnboardingStore from "@db/auth-onboarding-store";
import workspaceStore, {
  type WorkspaceKeyRecord,
  type WorkspaceSummary,
} from "@db/workspace-store";
import {
  WORKSPACE_KEY_ALGORITHM,
  hashWorkspaceKey,
  isWorkspaceKey,
  normalizeWorkspaceEmail,
} from "@/services/workspace-key";

const SALT_ROUNDS = 10;
const MAX_NAME_LENGTH = 120;
const MAX_WORKSPACE_NAME_LENGTH = 120;
const MAX_PASSWORD_BYTES = 72;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_WORKSPACE_ICON = "lucide:boxes";

export interface RegisterInput {
  email: string;
  password: string;
  name: string;
}

export interface WorkspaceRegisterInput extends RegisterInput {
  key: string;
  workspaceName: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export type RegisterResult =
  | { ok: true; user: Schema.User; workspace: WorkspaceSummary; tokens: TokenPair }
  | { ok: false; reason: "validation" | "invalid_key" | "email_taken" | "failed" };

export type WorkspaceKeyPreview =
  | { valid: true; name: string; email: string }
  | { valid: false };

/**
 * Login devolve o usuário JUNTO do par de tokens. Antes vinha só o par, e o
 * frontend completava com `GET /users` pegando o primeiro item — um contrato
 * frágil que dependia do backend escopar a listagem ao token. Com o usuário
 * aqui, aquela ida some.
 */
export type LoginResult = { user: Schema.User; tokens: TokenPair };

/**
 * Concentra o fluxo de autenticação (register/login/refresh). Trabalha com o
 * tipo interno Schema.UserCredentials (que carrega o password_hash) e SEMPRE
 * devolve o usuário sanitizado (sem hash) pra fora.
 *
 * Tempos de token e rotação ficam no jwt-service: cada login/refresh emite um
 * par NOVO (access 15m / refresh 7d), empurrando a janela de 7d a cada uso
 * ativo -- a sessão "desliza" e só expira após 7 dias de inatividade.
 */
class AuthController {
  private readonly users = new Model<Schema.UserCredentials>("users");

  public async register(input: RegisterInput): Promise<RegisterResult> {
    const values = this.cleanRegistration(input);
    if (!values) return { ok: false, reason: "validation" };

    try {
      const existing = await authOnboardingStore.findUserByCanonicalEmail(values.email);
      if (existing) return { ok: false, reason: "email_taken" };

      const firstName = values.name.split(/\s+/)[0]!;
      return await this.provisionRegistration(values, {
        workspaceName: `Area de Trabalho do ${firstName}`,
      });
    } catch (error) {
      if (await this.emailExists(values.email)) return { ok: false, reason: "email_taken" };
      this.log(error);
      return { ok: false, reason: "failed" };
    }
  }

  /**
   * Preview público para o multiform. Posse do segredo de 192 bits autoriza a
   * leitura do destinatário; qualquer falha conserva a mesma resposta para não
   * revelar estado, expiração, finalidade ou existência de registros.
   */
  public async previewWorkspaceKey(key: unknown): Promise<WorkspaceKeyPreview> {
    try {
      const record = await this.resolvePublicCreateKey(key);
      return record
        ? { valid: true, name: record.issued_to_name, email: record.issued_to_email }
        : { valid: false };
    } catch (error) {
      this.log(error);
      return { valid: false };
    }
  }

  public async registerWithWorkspace(input: WorkspaceRegisterInput): Promise<RegisterResult> {
    const values = this.cleanRegistration(input);
    const workspaceName = this.cleanWorkspaceName(input.workspaceName);
    if (!values || !workspaceName) return { ok: false, reason: "validation" };

    try {
      // A chave vem antes da consulta de e-mail: sem uma credencial válida, a
      // rota não vira um oráculo de contas já cadastradas.
      const key = await this.resolvePublicCreateKey(input.key);
      if (!key) return { ok: false, reason: "invalid_key" };

      const existing = await authOnboardingStore.findUserByCanonicalEmail(values.email);
      if (existing) return { ok: false, reason: "email_taken" };

      return await this.provisionRegistration(values, { workspaceName, key });
    } catch (error) {
      if (await this.emailExists(values.email)) return { ok: false, reason: "email_taken" };
      this.log(error);
      return { ok: false, reason: "failed" };
    }
  }

  public async login({ email, password }: LoginInput): Promise<LoginResult | null> {
    try {
      if (typeof email !== "string" || typeof password !== "string") return null;
      const normalizedEmail = normalizeWorkspaceEmail(email);
      const user = await authOnboardingStore.findUserByCanonicalEmail(normalizedEmail);

      // Sem usuário ou sem hash (ex: criado via POST /users só com email) -> não loga.
      if (!user?.password_hash) return null;

      const matches = await bcrypt.compare(password, user.password_hash);
      if (!matches) return null;

      return {
        user: this.sanitize(user),
        tokens: jwtService.issueTokenPair({ sub: user.id }, user.token_version ?? 0),
      };
    } catch (error) {
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return null;
    }
  }

  /**
   * O usuário do token — o que `GET /auth/me` devolve. É o que sustenta o
   * guard de rota do frontend depois que o `localStorage` deixou de guardar o
   * usuário: quem responde "você está logado, e é este" é o servidor.
   */
  public async me(userId: string): Promise<Schema.User | null> {
    try {
      const user = await this.users.find({ id: userId } as LookupValues<Schema.UserCredentials>);
      return user ? this.sanitize(user) : null;
    } catch (error) {
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return null;
    }
  }

  /**
   * Troca um refresh válido por um par NOVO: reemite os dois tokens e
   * **rotaciona o cookie** (o cliente recebe um `Set-Cookie` fresco). Como o
   * novo refresh nasce com `exp = agora + 7d`, cada refresh EMPURRA a janela —
   * a sessão "desliza" e só expira após 7 dias de INATIVIDADE, não 7 dias
   * desde o login.
   *
   * ATENÇÃO — a rotação aqui NÃO invalida o refresh anterior: ele reusa o
   * mesmo `token_version`, então o token antigo continua válido no servidor até
   * expirar sozinho ou até um logout (que incrementa o contador e mata todos de
   * uma vez). É rotação de CONVENIÊNCIA (cookie fresco + janela deslizante),
   * não detecção de reuso estilo OAuth — uma cópia roubada também desliza. Ver
   * `cubs-frontend/docs/demanda-backend.md`.
   *
   * Duas verificações, e as duas são necessárias:
   *  1. assinatura/expiração (jwt-service) — o token é autêntico?
   *  2. `token_version` contra o banco — a conta não revogou desde a emissão?
   *
   * Sem a (2), o logout não passaria de apagar um cookie: uma cópia roubada do
   * refresh continuaria valendo até expirar sozinha.
   */
  public async refresh(refreshToken: string): Promise<TokenPair | null> {
    try {
      const { sub, tv } = jwtService.verifyRefreshToken(refreshToken);

      const user = await this.users.find({ id: sub } as LookupValues<Schema.UserCredentials>);
      if (!user) return null;

      // Token emitido antes de um logout (ou de qualquer revogação futura).
      const current = user.token_version ?? 0;
      if ((tv ?? 0) !== current) return null;

      return jwtService.issueTokenPair({ sub }, current);
    } catch {
      return null;
    }
  }

  /**
   * Revoga TODOS os refresh tokens da conta dona deste token — o logout.
   * Aceita o token (e não o userId) de propósito: quem chama é a rota de
   * logout, cuja única credencial é o cookie; exigir um access token válido
   * ali impediria justamente quem mais precisa deslogar, que é quem está com
   * a sessão meio quebrada.
   *
   * Falha em silêncio: um logout com cookie inválido não é erro, e a rota
   * limpa o cookie de qualquer jeito.
   */
  public async revoke(refreshToken: string): Promise<void> {
    try {
      const { sub } = jwtService.verifyRefreshToken(refreshToken);

      const user = await this.users.find({ id: sub } as LookupValues<Schema.UserCredentials>);
      if (!user) return;

      await this.users.update(
        { token_version: (user.token_version ?? 0) + 1 } as UpdateValues<Schema.UserCredentials>,
        { id: sub } as LookupValues<Schema.UserCredentials>,
      );
    } catch {
      // Cookie inválido/expirado: não há sessão para revogar.
    }
  }

  /**
   * Remove os campos INTERNOS antes de devolver o usuário a qualquer consumidor
   * HTTP: o hash da senha e o `token_version` (contador de revogação — estado
   * de sessão, não dado do usuário; expô-lo entregaria de graça a informação
   * de quantas vezes a conta deslogou).
   */
  private sanitize(user: Schema.UserCredentials): Schema.User {
    const { password_hash, token_version, ...safe } = user;
    return safe;
  }

  private cleanRegistration(input: RegisterInput): RegisterInput | null {
    if (typeof input.name !== "string" || typeof input.email !== "string") return null;
    if (
      typeof input.password !== "string"
      || input.password.length < 6
      || Buffer.byteLength(input.password, "utf8") > MAX_PASSWORD_BYTES
    ) return null;

    const name = input.name.trim().replace(/\s+/g, " ");
    const email = normalizeWorkspaceEmail(input.email);
    if (!name || name.length > MAX_NAME_LENGTH) return null;
    if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) return null;
    return { name, email, password: input.password };
  }

  private cleanWorkspaceName(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const clean = value.trim().replace(/\s+/g, " ");
    return clean && clean.length <= MAX_WORKSPACE_NAME_LENGTH ? clean : null;
  }

  private async resolvePublicCreateKey(key: unknown): Promise<WorkspaceKeyRecord | null> {
    if (!isWorkspaceKey(key)) return null;
    const record = await workspaceStore.getAccessKey(hashWorkspaceKey(key));
    if (!record || record.algorithm_version !== WORKSPACE_KEY_ALGORITHM) return null;
    if (record.purpose !== "create" || record.workspace_id) return null;
    if (record.consumed_at || record.revoked_at) return null;
    const expiresAt = Date.parse(record.expires_at);
    return Number.isFinite(expiresAt) && expiresAt > Date.now() ? record : null;
  }

  private async provisionRegistration(
    values: RegisterInput,
    options: { workspaceName: string; key?: WorkspaceKeyRecord },
  ): Promise<RegisterResult> {
    const userId = ulid();
    const workspaceId = ulid();
    const passwordHash = await bcrypt.hash(values.password, SALT_ROUNDS);
    const provision = {
      userId,
      userName: values.name,
      userEmail: values.email,
      passwordHash,
      workspaceId,
      workspaceName: options.workspaceName,
      workspaceIcon: DEFAULT_WORKSPACE_ICON,
      membershipId: ulid(),
    };
    const committed = options.key
      ? await authOnboardingStore.createWorkspaceWithKey({
          ...provision,
          keyId: options.key.id,
          keyHash: options.key.key_hash,
          keyAlgorithm: WORKSPACE_KEY_ALGORITHM,
          keyLinkId: ulid(),
        })
      : await authOnboardingStore.createPrivateWorkspace(provision);
    if (!committed) {
      return { ok: false, reason: options.key ? "invalid_key" : "failed" };
    }

    const [created, workspace] = await Promise.all([
      this.users.find({ id: userId } as LookupValues<Schema.UserCredentials>),
      workspaceStore.getForUser(workspaceId, userId),
    ]);
    if (!created || !workspace) return { ok: false, reason: "failed" };

    return {
      ok: true,
      user: this.sanitize(created),
      workspace,
      tokens: jwtService.issueTokenPair({ sub: created.id }, created.token_version ?? 0),
    };
  }

  private async emailExists(email: string): Promise<boolean> {
    try {
      return !!await authOnboardingStore.findUserByCanonicalEmail(email);
    } catch {
      return false;
    }
  }

  private log(error: unknown): void {
    if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
  }
}

// Singleton: as rotas importam direto, sem conhecer req/res.
export default new AuthController();
