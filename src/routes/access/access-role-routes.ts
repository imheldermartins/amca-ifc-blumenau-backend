import type { RequestHandler, Router } from "express";
import controller from "@controllers/access-controller";
import { sendAccessResult } from "@/routes/access/access-result-responder";
import { AccessRouteContext } from "@/routes/access/access-route-context";
import { routeParam } from "@/routes/request-values";

export class AccessRoleRoutes {
  public register(router: Router): void {
    router.get("/:scope/:id/roles", this.list);
    router.post("/:scope/:id/roles", this.create);
    router.put("/:scope/:id/roles/:roleId", this.update);
    router.delete("/:scope/:id/roles/:roleId", this.remove);
    router.get(
      "/:scope/:id/organization-workspace-roles",
      this.listOrganizationWorkspaceRoles,
    );
    router.post("/:scope/:id/roles/:roleId/copy", this.copyWorkspaceRole);
  }

  private readonly list: RequestHandler = async (req, res) => {
    const { scope, resourceId, actorId } = AccessRouteContext.from(req);
    const result = await controller.roles(scope, resourceId, actorId);

    return sendAccessResult(res, result);
  };

  private readonly create: RequestHandler = async (req, res) => {
    const { scope, resourceId, actorId } = AccessRouteContext.from(req);
    const result = await controller.saveRole(
      scope,
      resourceId,
      actorId,
      req.body ?? {},
    );

    return sendAccessResult(res, result);
  };

  private readonly update: RequestHandler = async (req, res) => {
    const { scope, resourceId, actorId } = AccessRouteContext.from(req);
    const result = await controller.saveRole(
      scope,
      resourceId,
      actorId,
      req.body ?? {},
      routeParam(req, "roleId"),
    );

    return sendAccessResult(res, result);
  };

  private readonly remove: RequestHandler = async (req, res) => {
    const { scope, resourceId, actorId } = AccessRouteContext.from(req);
    const result = await controller.removeRole(
      scope,
      resourceId,
      actorId,
      routeParam(req, "roleId"),
    );

    return sendAccessResult(res, result);
  };

  private readonly listOrganizationWorkspaceRoles: RequestHandler = async (
    req,
    res,
  ) => {
    const { scope, resourceId, actorId } = AccessRouteContext.from(req);
    const result = await controller.organizationWorkspaceRoles(
      scope,
      resourceId,
      actorId,
    );

    return sendAccessResult(res, result);
  };

  private readonly copyWorkspaceRole: RequestHandler = async (req, res) => {
    const { scope, resourceId, actorId } = AccessRouteContext.from(req);
    const result = await controller.copyWorkspaceRole(
      scope,
      resourceId,
      actorId,
      routeParam(req, "roleId"),
    );

    return sendAccessResult(res, result);
  };
}
