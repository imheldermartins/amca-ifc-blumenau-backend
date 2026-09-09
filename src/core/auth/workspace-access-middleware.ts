import type { NextFunction, Request, Response } from "express";
import workspaceStore from "@db/workspace-store";
import {
  defineWorkspaceAbility,
  type WorkspaceAction,
  type WorkspaceSubject,
} from "./workspace-ability.js";
import { StatusCode } from "@core/http/status-code";

export function requireWorkspaceAbility(
  action: WorkspaceAction,
  subject: WorkspaceSubject,
  param = "id",
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const userId = req.userId;
    const workspaceId = req.params[param];

    if (!userId || typeof workspaceId !== "string") {
      res.status(StatusCode.UNAUTHORIZED).json({ message: "Não autorizado" });
      return;
    }

    try {
      const membership = await workspaceStore.getMembership(workspaceId, userId);
      if (!membership) {
        res.status(StatusCode.NOT_FOUND).json({ message: '"Workspace" não encontrado' });
        return;
      }

      if (!defineWorkspaceAbility(membership.role).can(action, subject)) {
        res.status(StatusCode.FORBIDDEN).json({ message: "Acesso não permitido" });
        return;
      }

      res.locals.workspaceMembership = membership;
      next();
    } catch (error) {
      if (error instanceof Error) {
        console.error(`[${error.cause}] ${error.message}`);
      }
      res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Erro no servidor" });
    }
  };
}
