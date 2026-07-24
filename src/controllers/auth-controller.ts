import bcrypt from "bcryptjs";
import { Model } from "@/core/db/model";
import type { Schema } from "@/models/schemas/index";
import jwtService, { type TokenPair } from "@core/auth/jwt-service";

const SALT_ROUNDS = 10;

export interface RegisterInput {
  email: string;
  password: string;
  name?: string | null;
}

export interface LoginInput {
  email: string;
  password: string;
}

export type RegisterResult =
  | { ok: true; user: Schema.User; tokens: TokenPair }
  | { ok: false; reason: "email_taken" | "failed" };

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

  public async register({ email, password, name = null }: RegisterInput): Promise<RegisterResult> {
    try {
      const existing = await this.users.find({ email } as LookupValues<Schema.UserCredentials>);
      if (existing) return { ok: false, reason: "email_taken" };

      const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

      const created = await this.users.create(
        { name, email, password_hash } as CreateValues<Schema.UserCredentials>,
      );
      if (!created) return { ok: false, reason: "failed" };

      const tokens = jwtService.issueTokenPair(
        { sub: created.id },
        created.token_version ?? 0,
      );
      return { ok: true, user: this.sanitize(created), tokens };
    } catch (error) {
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return { ok: false, reason: "failed" };
    }
  }

  public async login({ email, password }: LoginInput): Promise<LoginResult | null> {
    try {
      const user = await this.users.find({ email } as LookupValues<Schema.UserCredentials>);

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
}

// Singleton: as rotas importam direto, sem conhecer req/res.
export default new AuthController();
