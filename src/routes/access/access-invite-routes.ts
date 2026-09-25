import type { RequestHandler, Router } from "express";
import controller from "@controllers/access-controller";
import { sendAccessResult } from "@/routes/access/access-result-responder";
import { AccessRouteContext } from "@/routes/access/access-route-context";
import { routeParam } from "@/routes/request-values";
import { StatusCode } from "@/services/http/status-code";

export class AccessInviteRoutes {
  public register(router: Router): void {
    router.get("/:scope/:id/invites", this.list);
    router.post("/:scope/:id/invites", this.create);
    router.delete("/:scope/:id/invites/:inviteId", this.remove);
  }

  private readonly list: RequestHandler = async (req, res) => {
    const { scope, resourceId, actorId } = AccessRouteContext.from(req);
    const result = await controller.invites(scope, resourceId, actorId);

    return sendAccessResult(res, result);
  };

  private readonly create: RequestHandler = async (req, res) => {
    const { scope, resourceId, actorId } = AccessRouteContext.from(req);
    const result = await controller.createInvite(
      scope,
      resourceId,
      actorId,
      req.body ?? {},
    );

    return sendAccessResult(res, result, StatusCode.CREATED);
  };

  private readonly remove: RequestHandler = async (req, res) => {
    const { scope, resourceId, actorId } = AccessRouteContext.from(req);
    const result = await controller.removeInvite(
      scope,
      resourceId,
      actorId,
      routeParam(req, "inviteId"),
    );

    return sendAccessResult(res, result);
  };
}
