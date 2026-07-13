import { rateLimit } from "express-rate-limit";
import { StatusCode } from "@core/http/status-code";

/**
 * Limites de requisições por IP, para segurar rajadas/brute-force sem
 * derrubar o servidor. Dois níveis:
 *
 *  - globalRateLimit: todas as rotas HTTP. Generoso — só corta abuso
 *    (RATE_LIMIT_MAX req por RATE_LIMIT_WINDOW_MS; default 300/min).
 *  - authRateLimit: só /auth (login/register/refresh). Agressivo — poucas
 *    tentativas por janela para frear adivinhação de senha
 *    (AUTH_RATE_LIMIT_MAX por AUTH_RATE_LIMIT_WINDOW_MS; default 20/15min).
 *
 * Atrás do nginx (prod), TRUST_PROXY=1 é obrigatório (ver http-server.ts):
 * sem ele o IP visto aqui seria o do proxy, e o limite valeria para TODOS
 * os usuários juntos.
 *
 * Estado em memória por instância — com múltiplas instâncias do backend,
 * trocar por um store compartilhado (mesmo momento do adapter Redis do
 * socket.io; ver NEXT_STEPS.md).
 */
const envInt = (name: string, fallback: number): number => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const tooManyRequests = (message: string) => ({
  statusCode: StatusCode.TOO_MANY_REQUESTS,
  message: { message },
  standardHeaders: "draft-8" as const, // header RateLimit-* padronizado
  legacyHeaders: false,
});

export const globalRateLimit = rateLimit({
  windowMs: envInt("RATE_LIMIT_WINDOW_MS", 60_000),
  limit: envInt("RATE_LIMIT_MAX", 300),
  ...tooManyRequests("Muitas requisições — tente novamente em instantes"),
});

export const authRateLimit = rateLimit({
  windowMs: envInt("AUTH_RATE_LIMIT_WINDOW_MS", 15 * 60_000),
  limit: envInt("AUTH_RATE_LIMIT_MAX", 20),
  ...tooManyRequests("Muitas tentativas de autenticação — aguarde antes de tentar de novo"),
});
