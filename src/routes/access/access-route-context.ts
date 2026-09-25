import type { Request } from "express";
import type { AccessScope } from "@/services/auth/permissions";
import { authenticatedUserId, routeParam } from "@/routes/request-values";

export class AccessRouteContext {
  public constructor(
    public readonly scope: AccessScope,
    public readonly resourceId: string,
    public readonly actorId: string,
  ) {}

  public static from(req: Request): AccessRouteContext {
    return new AccessRouteContext(
      routeParam(req, "scope") as AccessScope,
      routeParam(req, "id"),
      authenticatedUserId(req),
    );
  }
}
