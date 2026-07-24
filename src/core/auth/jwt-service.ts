import jwt, { type SignOptions } from "jsonwebtoken";
import { isProduction, warnOnce } from "@core/env";

export interface JwtPayload {
  sub: string; // user id
}

/**
 * O refresh carrega um campo a mais: `tv`, o `token_version` do usuário no
 * momento da emissão. Quem valida compara com o valor atual da linha — é o
 * que permite o logout REVOGAR de verdade (incrementar o contador mata todos
 * os refresh já emitidos para a conta).
 *
 * Só o refresh carrega `tv`. O access continua stateless e sem leitura de
 * banco: ele vive 15 min, e a revogação alcança a sessão no refresh seguinte.
 * É a troca consciente entre custo por requisição e janela de revogação.
 */
export interface RefreshPayload extends JwtPayload {
  tv: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/** Piso de entropia para um segredo de assinatura (256 bits em hex = 64 chars). */
export const MIN_SECRET_LENGTH = 32;

/**
 * Resolve um segredo de assinatura, e em produção RECUSA subir sem ele.
 *
 * O fallback literal que existia aqui era a falha mais grave do projeto: com a
 * env ausente, todo token do sistema passava a ser assinado com uma string
 * versionada neste repositório — qualquer pessoa forjaria um token para
 * qualquer `sub`. Não é roubo de sessão, é falsificação de identidade
 * arbitrária. Servidor que não sobe é infinitamente melhor.
 *
 * Em dev o fallback continua (é o que faz `npm run dev` funcionar sem
 * configurar nada), mas avisa uma vez — tolerado não é o mesmo que invisível.
 */
function requireSecret(name: string, devFallback: string): string {
  const value = process.env[name];

  if (value && value.length >= MIN_SECRET_LENGTH) return value;

  if (isProduction) {
    const problema = value ? `tem menos de ${MIN_SECRET_LENGTH} caracteres` : "não está definida";
    throw new Error(
      `[cubs:config] ${name} ${problema}. Em produção o segredo é obrigatório — ` +
        `gere um com \`openssl rand -hex 64\` e defina em .env.production ` +
        `(ou docker/backend.prod.env). Sem ele, qualquer pessoa forja tokens.`,
    );
  }

  warnOnce(
    name,
    `${name} ausente ou curta — usando o fallback de DESENVOLVIMENTO. ` +
      `Isso falharia no boot em produção (mínimo ${MIN_SECRET_LENGTH} caracteres).`,
  );
  return value || devFallback;
}

/**
 * Toda a lógica de accessToken/refreshToken fica encapsulada aqui -- quem
 * consome (middleware, rota de refresh, etc.) nunca lida com jwt.sign/verify
 * direto, nem com qual secret/tempo de expiração usar pra qual token.
 */
class JwtService {
  private readonly accessSecret = requireSecret("JWT_ACCESS_SECRET", "dev-access-secret");
  private readonly refreshSecret = requireSecret("JWT_REFRESH_SECRET", "dev-refresh-secret");
  private readonly accessExpiresIn: NonNullable<SignOptions["expiresIn"]> = "15m";
  private readonly refreshExpiresIn: NonNullable<SignOptions["expiresIn"]> = "7d";

  public signAccessToken(payload: JwtPayload): string {
    return jwt.sign(payload, this.accessSecret, { expiresIn: this.accessExpiresIn });
  }

  public signRefreshToken(payload: RefreshPayload): string {
    return jwt.sign(payload, this.refreshSecret, { expiresIn: this.refreshExpiresIn });
  }

  /**
   * Emite o par. O `tokenVersion` é o do usuário AGORA — quem chama precisa
   * tê-lo lido do banco, e é justamente por isso que ele é parâmetro
   * obrigatório: assinar um refresh sem versão criaria um token que nenhum
   * logout consegue matar.
   */
  public issueTokenPair(payload: JwtPayload, tokenVersion: number): TokenPair {
    return {
      accessToken: this.signAccessToken(payload),
      refreshToken: this.signRefreshToken({ ...payload, tv: tokenVersion }),
    };
  }

  public verifyAccessToken(token: string): JwtPayload {
    return jwt.verify(token, this.accessSecret) as JwtPayload;
  }

  /**
   * Verifica ASSINATURA e validade do refresh. NÃO confere o `token_version`:
   * isso exige ir ao banco, e quem faz é o auth-controller (que já tem o
   * Model). Aqui fica só a criptografia.
   */
  public verifyRefreshToken(token: string): RefreshPayload {
    return jwt.verify(token, this.refreshSecret) as RefreshPayload;
  }
}

export default new JwtService();