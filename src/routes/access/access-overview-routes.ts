import type { RequestHandler, Router } from "express";
import controller from "@controllers/access-controller";
import { sendAccessResult } from "@/routes/access/access-result-responder";
import { AccessRouteContext } from "@/routes/access/access-route-context";
import { PERMISSION_CATALOG } from "@/services/auth/permissions";
import { StatusCode } from "@/services/http/status-code";

export class AccessOverviewRoutes {
  public registerCatalog(router: Router): void {
    router.get("/catalog", this.getCatalog);
  }

  public registerCurrentAccess(router: Router): void {
    router.get("/:scope/:id", this.getCurrentAccess);
  }

  private readonly getCatalog: RequestHandler = (_req, res) => {
    return res.status(StatusCode.OK).json(PERMISSION_CATALOG);
  };

  private readonly getCurrentAccess: RequestHandler = async (req, res) => {
    const { scope, resourceId, actorId } = AccessRouteContext.from(req);
    const result = await controller.current(scope, resourceId, actorId);

    return sendAccessResult(res, result);
  };
}
