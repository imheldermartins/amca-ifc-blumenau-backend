import type { NextFunction, Request, Response } from "express";
import controller from "@controllers/access-controller";
import type { AccessResult } from "@/controllers/types/access-controller.types";
import { ApplicationRouter } from "@/routes/application-router";
import middleware from "@/services/auth/middleware";
import { ACCESS_SCOPES, PERMISSION_CATALOG } from "@/services/auth/permissions";
import type { AccessScope } from "@/services/auth/permissions";
import { StatusCode } from "@/services/http/status-code";
import { ULID_RE } from "@db/scoped-access-store";

export class AccessRouter extends ApplicationRouter {
  public constructor() {
    super(middleware.handle);
  }

  protected registerRoutes(): void {
    this.router.get("/catalog", this.catalog.bind(this));
    this.router.use("/:scope/:id", this.validateScope.bind(this));
    this.router.get("/:scope/:id", this.current.bind(this));
    this.router.get("/:scope/:id/roles", this.roles.bind(this));
    this.router.post("/:scope/:id/roles", this.createRole.bind(this));
    this.router.put("/:scope/:id/roles/:roleId", this.updateRole.bind(this));
    this.router.delete("/:scope/:id/roles/:roleId", this.removeRole.bind(this));
    this.router.get("/:scope/:id/organization-workspace-roles", this.organizationWorkspaceRoles.bind(this));
    this.router.post("/:scope/:id/roles/:roleId/copy", this.copyWorkspaceRole.bind(this));
    this.router.get("/:scope/:id/members", this.members.bind(this));
    this.router.get("/:scope/:id/member/:memberId", this.member.bind(this));
    this.router.post("/:scope/:id/members", this.addMember.bind(this));
    this.router.put("/:scope/:id/member/:userId", this.assignMember.bind(this));
    this.router.delete("/:scope/:id/member/:userId", this.removeMember.bind(this));
    this.router.get("/:scope/:id/member-search", this.searchMember.bind(this));
    this.router.get("/:scope/:id/invites", this.invites.bind(this));
    this.router.post("/:scope/:id/invites", this.createInvite.bind(this));
    this.router.delete("/:scope/:id/invites/:inviteId", this.removeInvite.bind(this));
    this.router.get("/:scope/:id/requests", this.requests.bind(this));
    this.router.post("/:scope/:id/requests", this.requestAccess.bind(this));
    this.router.post("/:scope/:id/requests/:requestId/decision", this.decideRequest.bind(this));
  }

  private catalog(_req: Request, res: Response): Response {
    return res.status(StatusCode.OK).json(PERMISSION_CATALOG);
  }

  private validateScope(req: Request, res: Response, next: NextFunction): void {
    if (!ACCESS_SCOPES.includes(req.params.scope as AccessScope) || !ULID_RE.test(req.params.id as string)) {
      res.status(StatusCode.BAD_REQUEST).json({ message: "Escopo inválido" });
      return;
    }
    next();
  }

  private async current(req: Request, res: Response): Promise<Response> {
    return this.send(res, await controller.current(...this.context(req)));
  }

  private async roles(req: Request, res: Response): Promise<Response> {
    return this.send(res, await controller.roles(...this.context(req)));
  }

  private async createRole(req: Request, res: Response): Promise<Response> {
    return this.send(res, await controller.saveRole(...this.context(req), req.body ?? {}));
  }

  private async updateRole(req: Request, res: Response): Promise<Response> {
    return this.send(res, await controller.saveRole(...this.context(req), req.body ?? {}, req.params.roleId as string));
  }

  private async removeRole(req: Request, res: Response): Promise<Response> {
    return this.send(res, await controller.removeRole(...this.context(req), req.params.roleId as string));
  }

  private async organizationWorkspaceRoles(req: Request, res: Response): Promise<Response> {
    return this.send(res, await controller.organizationWorkspaceRoles(...this.context(req)));
  }

  private async copyWorkspaceRole(req: Request, res: Response): Promise<Response> {
    return this.send(res, await controller.copyWorkspaceRole(...this.context(req), req.params.roleId as string));
  }

  private async members(req: Request, res: Response): Promise<Response> {
    return this.send(res, await controller.members(...this.context(req)));
  }

  private async member(req: Request, res: Response): Promise<Response> {
    return this.send(res, await controller.members(...this.context(req), req.params.memberId as string));
  }

  private async addMember(req: Request, res: Response): Promise<Response> {
    return this.send(res, await controller.addMember(...this.context(req), req.body ?? {}));
  }

  private async assignMember(req: Request, res: Response): Promise<Response> {
    return this.send(res, await controller.assign(...this.context(req), req.params.userId as string, req.body?.roleId));
  }

  private async removeMember(req: Request, res: Response): Promise<Response> {
    return this.send(res, await controller.removeMember(...this.context(req), req.params.userId as string));
  }

  private async searchMember(req: Request, res: Response): Promise<Response> {
    return this.send(res, await controller.searchEmail(...this.context(req), req.query.email));
  }

  private async invites(req: Request, res: Response): Promise<Response> {
    return this.send(res, await controller.invites(...this.context(req)));
  }

  private async createInvite(req: Request, res: Response): Promise<Response> {
    return this.send(res, await controller.createInvite(...this.context(req), req.body ?? {}), StatusCode.CREATED);
  }

  private async removeInvite(req: Request, res: Response): Promise<Response> {
    return this.send(res, await controller.removeInvite(...this.context(req), req.params.inviteId as string));
  }

  private async requests(req: Request, res: Response): Promise<Response> {
    return this.send(res, await controller.requests(...this.context(req)));
  }

  private async requestAccess(req: Request, res: Response): Promise<Response> {
    return this.send(res, await controller.request(...this.context(req)));
  }

  private async decideRequest(req: Request, res: Response): Promise<Response> {
    return this.send(res, await controller.decide(...this.context(req), req.params.requestId as string, req.body ?? {}));
  }

  private context(req: Request): [AccessScope, string, string] {
    return [req.params.scope as AccessScope, req.params.id as string, req.userId as string];
  }

  private send(res: Response, result: AccessResult, successStatus = StatusCode.OK): Response {
    if (result.ok) return res.status(successStatus).json(result.data);
    const statuses = {
      validation: StatusCode.BAD_REQUEST,
      forbidden: StatusCode.FORBIDDEN,
      conflict: StatusCode.CONFLICT,
      server_error: StatusCode.INTERNAL_SERVER_ERROR,
    } as const;
    return res.status(statuses[result.reason]).json({ message: result.message });
  }
}

export default new AccessRouter().build();
