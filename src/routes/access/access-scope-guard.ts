import type { RequestHandler } from "express";
import { ACCESS_SCOPES, type AccessScope } from "@/services/auth/permissions";
import { StatusCode } from "@/services/http/status-code";
import { ULID_RE } from "@/utils/ulid";

export class AccessScopeGuard {
  public readonly handle: RequestHandler = (req, res, next) => {
    const scope = req.params.scope as AccessScope;
    const resourceId = req.params.id as string;

    if (!ACCESS_SCOPES.includes(scope) || !ULID_RE.test(resourceId)) {
      res.status(StatusCode.BAD_REQUEST).json({ message: "Escopo inválido" });
      return;
    }

    next();
  };
}
