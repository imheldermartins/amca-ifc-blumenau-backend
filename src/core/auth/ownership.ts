import type { Request, Response, NextFunction } from "express";
import { StatusCode } from "@core/http/status-code";

/**
 * Autorização por dono: o token só dá acesso aos recursos do próprio usuário.
 *
 * Para a collection de usuários, o id do recurso (/:id) É o próprio id do
 * usuário, então basta comparar com req.userId. O auth middleware DEVE rodar
 * antes deste (é ele quem preenche req.userId).
 *
 * Para outras collections (pages, etc.), o dono vive em owner_id e exige uma
 * consulta ao banco -- esse será o ponto de extensão (ex: ownership.owns(model)).
 */
class Ownership {
  // Recurso /:id pertence ao usuário do token (id do recurso == id do usuário).
  public readonly self = (req: Request, res: Response, next: NextFunction): void => {
    if (!req.userId || req.params.id !== req.userId) {
      res.status(StatusCode.FORBIDDEN).json({ message: "Você só pode acessar seus próprios recursos" });
      return;
    }
    next();
  };
}

export default new Ownership();
