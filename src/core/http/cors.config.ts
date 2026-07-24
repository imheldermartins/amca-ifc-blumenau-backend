import type { CorsOptions } from "cors";
import { isProduction, warnOnce } from "@core/env";

/**
 * CORS do backend — a MESMA config alimenta o express e o handshake do
 * socket.io (ver socket-server.ts).
 *
 * `credentials: true` é o que permite o cookie de sessão (o refresh
 * `__Host-cubs_rt`) viajar numa chamada cross-origin. E é ele que torna
 * `origin: "*"` INVÁLIDO: o navegador recusa a combinação curinga+credencial —
 * não é "menos permissivo", simplesmente não funciona. Por isso o antigo
 * default `"*"` teve que morrer:
 *
 *   - produção: `CORS_ORIGINS` vazio agora FALHA no boot (antes virava "*" em
 *     silêncio, que é o pior default possível);
 *   - desenvolvimento: cai no `http://localhost:5173` do Vite, que é o valor
 *     que 99% dos casos querem.
 *
 * Vale lembrar que no caminho padrão de dev o CORS nem chega a engajar: o
 * frontend fala com `/api` na PRÓPRIA origem (:5173) e o proxy do Vite repassa
 * para :3000, então o navegador vê mesma origem. Isto aqui só entra em cena
 * quando o front aponta direto para o backend (`VITE_CUBS_API_URL`).
 */
const DEV_ORIGIN = "http://localhost:5173";

const parseOrigins = (raw: string | undefined): string[] =>
  (raw ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

const resolveOrigins = (): string | string[] => {
  const origins = parseOrigins(process.env.CORS_ORIGINS);

  if (origins.length === 0) {
    if (isProduction) {
      throw new Error(
        "[cubs:config] CORS_ORIGINS não está definida. Em produção a lista de " +
          "origens é obrigatória — defina as URLs públicas do site separadas por " +
          "vírgulas (ex.: CORS_ORIGINS=https://cubs.example.com). O curinga '*' " +
          "não é aceito pelo navegador junto com cookie de sessão.",
      );
    }
    warnOnce(
      "CORS_ORIGINS",
      `CORS_ORIGINS ausente — liberando só ${DEV_ORIGIN} (default de desenvolvimento).`,
    );
    return DEV_ORIGIN;
  }

  return origins.length === 1 ? (origins[0] as string) : origins;
};

export const corsConfig: CorsOptions = {
  origin: resolveOrigins(),
  // Sem isto o cookie de refresh não acompanha requisição cross-origin — e o
  // login "funciona" até o primeiro F5, quando não há o que restaurar.
  credentials: true,
};
