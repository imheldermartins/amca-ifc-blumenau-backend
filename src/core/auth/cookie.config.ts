import type { CookieOptions } from "express";
import { isProduction } from "@core/env";

/**
 * Política do cookie de sessão — a FONTE ÚNICA. Nenhum outro arquivo decide
 * atributo de cookie; quem precisa, importa daqui.
 *
 * O que mora no cookie é APENAS o refresh token. O access token não: ele fica
 * em memória no frontend, some no reload e é reconstruído por
 * `POST /auth/refresh`. A divisão é o ponto do desenho — a credencial LONGA
 * (7 dias) é a que um XSS não pode alcançar, e `HttpOnly` é exatamente isso.
 *
 * ┌──────────────┬────────────────────┬──────────────────────────────────┐
 * │              │ dev (http)         │ prod (https)                     │
 * ├──────────────┼────────────────────┼──────────────────────────────────┤
 * │ nome         │ cubs_rt            │ __Host-cubs_rt                   │
 * │ Secure       │ não                │ SIM (exigido pelo prefixo)       │
 * │ HttpOnly     │ sim                │ sim                              │
 * │ SameSite     │ Lax                │ Lax                              │
 * │ Path         │ /                  │ / (exigido pelo prefixo)         │
 * │ Domain       │ omitido            │ omitido (PROIBIDO pelo prefixo)  │
 * └──────────────┴────────────────────┴──────────────────────────────────┘
 *
 * **Por que `__Host-` e não `__Secure-` com um Path estreito:** o prefixo
 * `__Host-` faz o navegador recusar o cookie se ele tiver `Domain` ou `Path`
 * diferente de `/` — ou seja, um subdomínio comprometido não consegue
 * sobrescrever a sessão do domínio principal (session fixation). O preço é o
 * cookie viajar em todo request da origem; sendo `HttpOnly`+`Secure`, isso é
 * ruído de rede, não exposição.
 *
 * **Por que `SameSite=Lax` e não `Strict`:** `Lax` já impede que o cookie
 * acompanhe um POST cross-site (que é o vetor de CSRF), e não quebra quem
 * chega no app por um link externo. `Strict` obrigaria uma segunda navegação
 * para a sessão ser reconhecida.
 *
 * O nome MUDA entre ambientes de propósito: o prefixo não é enfeite, é
 * contrato com o navegador. Usar `__Host-` em http faria o cookie ser
 * descartado em silêncio — o pior modo de falha possível.
 */

/** `Secure` em prod; em dev só com COOKIE_SECURE=1 (ex.: túnel https). */
const isSecure = isProduction || process.env.COOKIE_SECURE === "1";

/**
 * Nome do cookie. O prefixo `__Host-` só é válido acompanhado de `Secure`,
 * então ele segue o MESMO flag — nome e atributos não podem divergir.
 */
export const REFRESH_COOKIE_NAME = isSecure ? "__Host-cubs_rt" : "cubs_rt";

/** 7 dias, espelhando o `refreshExpiresIn` do jwt-service. */
export const REFRESH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Atributos de escrita. `domain` é OMITIDO (não `undefined` explícito): com
 * `__Host-`, declarar domain invalidaria o cookie.
 */
export function refreshCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax",
    path: "/",
    maxAge: REFRESH_MAX_AGE_MS,
  };
}

/**
 * Atributos de remoção. O navegador só apaga um cookie quando os atributos
 * BATEM com os da escrita (path e secure inclusive) — por isso não basta um
 * `res.clearCookie(nome)` seco, e por isso isto mora aqui junto do resto.
 */
export function clearRefreshCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax",
    path: "/",
  };
}
