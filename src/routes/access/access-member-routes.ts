import type { RequestHandler, Router } from "express";
import controller from "@controllers/access-controller";
import { sendAccessResult } from "@/routes/access/access-result-responder";
import { AccessRouteContext } from "@/routes/access/access-route-context";
import { routeParam } from "@/routes/request-values";

export class AccessMemberRoutes {
  public register(router: Router): void {
    router.get("/:scope/:id/members", this.list);
    router.get("/:scope/:id/member/:memberId", this.get);
    router.post("/:scope/:id/members", this.add);
    router.put("/:scope/:id/member/:userId", this.assign);
    router.delete("/:scope/:id/member/:userId", this.remove);
    router.get("/:scope/:id/member-search", this.searchByEmail);
  }

  private readonly list: RequestHandler = async (req, res) => {
    const { scope, resourceId, actorId } = AccessRouteContext.from(req);
    const result = await controller.members(scope, resourceId, actorId);

    return sendAccessResult(res, result);
  };

  private readonly get: RequestHandler = async (req, res) => {
    const { scope, resourceId, actorId } = AccessRouteContext.from(req);
    const result = await controller.members(
      scope,
      resourceId,
      actorId,
      routeParam(req, "memberId"),
    );

    return sendAccessResult(res, result);
  };

  private readonly add: RequestHandler = async (req, res) => {
    const { scope, resourceId, actorId } = AccessRouteContext.from(req);
    const result = await controller.addMember(
      scope,
      resourceId,
      actorId,
      req.body ?? {},
    );

    return sendAccessResult(res, result);
  };

  private readonly assign: RequestHandler = async (req, res) => {
    const { scope, resourceId, actorId } = AccessRouteContext.from(req);
    const result = await controller.assign(
      scope,
      resourceId,
      actorId,
      routeParam(req, "userId"),
      req.body?.roleId,
    );

    return sendAccessResult(res, result);
  };

  private readonly remove: RequestHandler = async (req, res) => {
    const { scope, resourceId, actorId } = AccessRouteContext.from(req);
    const result = await controller.removeMember(
      scope,
      resourceId,
      actorId,
      routeParam(req, "userId"),
    );

    return sendAccessResult(res, result);
  };

  private readonly searchByEmail: RequestHandler = async (req, res) => {
    const { scope, resourceId, actorId } = AccessRouteContext.from(req);
    const result = await controller.searchEmail(
      scope,
      resourceId,
      actorId,
      req.query.email,
    );

    return sendAccessResult(res, result);
  };
}
