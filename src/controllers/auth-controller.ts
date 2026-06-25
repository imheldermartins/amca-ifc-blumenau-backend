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

      const tokens = jwtService.issueTokenPair({ sub: created.id });
      return { ok: true, user: this.sanitize(created), tokens };
    } catch (error) {
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return { ok: false, reason: "failed" };
    }
  }

  public async login({ email, password }: LoginInput): Promise<TokenPair | null> {
    try {
      const user = await this.users.find({ email } as LookupValues<Schema.UserCredentials>);

      // Sem usuário ou sem hash (ex: criado via POST /users só com email) -> não loga.
      if (!user?.password_hash) return null;

      const matches = await bcrypt.compare(password, user.password_hash);
      if (!matches) return null;

      return jwtService.issueTokenPair({ sub: user.id });
    } catch (error) {
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return null;
    }
  }

  public refresh(refreshToken: string): TokenPair | null {
    try {
      const { sub } = jwtService.verifyRefreshToken(refreshToken);
      // Rotação: novo par (access + refresh), renovando a janela de 7d.
      return jwtService.issueTokenPair({ sub });
    } catch {
      return null;
    }
  }

  // Remove o hash antes de devolver o usuário a qualquer consumidor HTTP.
  private sanitize(user: Schema.UserCredentials): Schema.User {
    const { password_hash, ...safe } = user;
    return safe;
  }
}

// Singleton: as rotas importam direto, sem conhecer req/res.
export default new AuthController();
