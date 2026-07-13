import type { CorsOptions } from "cors";

/**
 * Origens permitidas vêm de CORS_ORIGINS (lista separada por vírgulas):
 *   CORS_ORIGINS=http://localhost:5173,https://cubs.example.com
 * Sem a env (ou vazia), mantém "*" — comportamento de dev, libera qualquer
 * client. Em produção defina a lista explícita (ver .env.production.example).
 */
const parseOrigins = (raw: string | undefined): CorsOptions["origin"] => {
  const origins = (raw ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  if (origins.length === 0) return "*";

  return origins.length === 1 ? origins[0] : origins;
};

export const corsConfig: CorsOptions = {
  origin: parseOrigins(process.env.CORS_ORIGINS),
};
