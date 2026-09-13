import { StatusCode } from "@core/http/status-code";
import type { Request, Response, NextFunction } from "express";
import scopedAccessStore from "@db/scoped-access-store";
import type { AccessScope, PermissionKind } from "./permissions.js";

export function requireScopedPermission(scope: AccessScope, kind: PermissionKind, action: string, param = "id") {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const scopeId = req.params[param];
    if (!req.userId || typeof scopeId !== "string") {
      res.status(StatusCode.UNAUTHORIZED).json({ message: "Não autorizado" });
      return;
    }
    try {
      if (!await scopedAccessStore.can(scope, scopeId, req.userId, kind, action)) {
        res.status(StatusCode.FORBIDDEN).json({ message: "Acesso não permitido" });
        return;
      }
      next();
    } catch {
      res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Erro no servidor" });
    }
  };
}
