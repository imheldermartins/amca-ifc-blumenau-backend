import type { Request, Response, NextFunction } from "express";
import { StatusCode } from "@core/http/status-code";

/**
 * Guarda de CSRF para as rotas autenticadas por COOKIE — hoje só
 * `/auth/refresh` e `/auth/logout`, as duas únicas que aceitam o cookie de
 * sessão como credencial. Todo o resto da API usa `Authorization: Bearer`,
 * que um site terceiro não consegue forjar (o navegador não anexa header por
 * conta própria), logo não tem superfície de CSRF.
 *
 * A defesa é em duas camadas, e a primeira já resolveria sozinha:
 *
 *  1. `SameSite=Lax` no cookie — o navegador NÃO envia o cookie num POST
 *     cross-site. É a barreira principal.
 *  2. exigir um header customizado, como aqui. Um `<form>` de outro site não
 *     consegue definir header nenhum; um `fetch()` que tente definir dispara
 *     preflight, e o preflight morre no CORS de origem explícita.
 *
 * **Por que NÃO há token de double-submit:** ele existe para o caso em que o
 * cookie é a credencial de TODA escrita. Aqui ele cobriria duas rotas que já
 * estão cobertas duas vezes, ao custo de emitir, guardar e sincronizar um
 * token. Se um dia o access token também virar cookie, essa conta muda e o
 * double-submit passa a ser necessário — este comentário é o gatilho.
 */
const CLIENT_HEADER = "x-cubs-client";

export const requireClientHeader = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (!req.headers[CLIENT_HEADER]) {
    // "ausente OU vazio": um header presente mas sem valor (ex.: template tag
    // que resolveu para nada) cai aqui também, e dizer só "sem o header"
    // manda procurar no lugar errado. O valor não é segredo — a proteção vem
    // de um site cross-site não CONSEGUIR enviar header customizado —, então
    // dizer qual valor mandar não enfraquece nada.
    res.status(StatusCode.FORBIDDEN).json({
      message:
        `Header ${CLIENT_HEADER} ausente ou vazio. Esta rota exige ` +
        `"${CLIENT_HEADER}: web" como proteção contra CSRF.`,
    });
    return;
  }
  next();
};
