import type { Request, Response, NextFunction } from "express";
import pageAccessController from "@/controllers/page-access-controller";
import { StatusCode } from "@core/http/status-code";

/**
 * Guarda de acesso a uma página, para rodar DEPOIS do `middleware.handle`
 * (que é quem preenche `req.userId`).
 *
 * Antes disto, cada rota decidia sozinha: `GET /pages/:id` filtrava a query
 * por `owner_id` — e por isso um colaborador nem abria a base compartilhada —
 * enquanto `/pages/:id/page` (dataset), `/pages/parent/:id/columns` e
 * `/breadcrumb` não checavam NADA: qualquer usuário autenticado lia a base de
 * qualquer página. Uma pergunta só resolve os dois lados.
 *
 * 404 e não 403 quando nega: para quem não tem acesso, a página não deve nem
 * existir — 403 confirmaria o id para quem está sondando.
 *
 * @param param nome do parâmetro de rota que carrega o id da página. Cuidado:
 *   em `/pages/:id/column/:column_id/value` o `:id` é a LINHA (página filha), e
 *   a herança de acesso pela árvore (ver `canAccessPage`) é o que faz o
 *   colaborador da base poder editá-la.
 */
export function requirePageAccess(param = "id") {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const pageId = req.params[param];
    const userId = req.userId;

    if (!userId || typeof pageId !== "string") {
      res.status(StatusCode.UNAUTHORIZED).json({ message: "Não autorizado" });
      return;
    }

    if (!(await pageAccessController.canAccessPage(userId, pageId))) {
      res.status(StatusCode.NOT_FOUND).json({ message: `"Page" não encontrado` });
      return;
    }

    next();
  };
}
