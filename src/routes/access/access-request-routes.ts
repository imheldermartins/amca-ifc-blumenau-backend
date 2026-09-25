import type { RequestHandler, Router } from "express";
import controller from "@controllers/access-controller";
import { sendAccessResult } from "@/routes/access/access-result-responder";
import { AccessRouteContext } from "@/routes/access/access-route-context";
import { routeParam } from "@/routes/request-values";

export class AccessRequestRoutes {
  public register(router: Router): void {
    router.get("/:scope/:id/requests", this.list);
    router.post("/:scope/:id/requests", this.create);
    router.post("/:scope/:id/requests/:requestId/decision", this.decide);
  }

  private readonly list: RequestHandler = async (req, res) => {
    const { scope, resourceId, actorId } = AccessRouteContext.from(req);
    const result = await controller.requests(scope, resourceId, actorId);

    return sendAccessResult(res, result);
  };

  private readonly create: RequestHandler = async (req, res) => {
    const { scope, resourceId, actorId } = AccessRouteContext.from(req);
    const result = await controller.request(scope, resourceId, actorId);

    return sendAccessResult(res, result);
  };

  private readonly decide: RequestHandler = async (req, res) => {
    const { scope, resourceId, actorId } = AccessRouteContext.from(req);
    const result = await controller.decide(
      scope,
      resourceId,
      actorId,
      routeParam(req, "requestId"),
      req.body ?? {},
    );

    return sendAccessResult(res, result);
  };
}
