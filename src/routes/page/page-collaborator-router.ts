import type { Request, Response } from "express";
import pageCollaboratorController, {
  PageCollaboratorController,
} from "@/controllers/page-collaborator-controller";
import { ApplicationRouter } from "@/routes/application-router";
import { sendPageFailure } from "@/routes/page/page-route-responder";
import { authenticatedUserId, routeParam } from "@/routes/request-values";
import middleware from "@/services/auth/middleware";
import { requireScopedPermission } from "@/services/auth/scoped-access-middleware";
import { StatusCode } from "@/services/http/status-code";

/** Fronteira HTTP do vínculo entre usuários e páginas. */
export class PageCollaboratorRouter extends ApplicationRouter {
  public constructor(
    private readonly collaborators: PageCollaboratorController = pageCollaboratorController,
  ) {
    super();
  }

  protected registerRoutes(): void {
    this.router.get(
      "/:id/collaborators",
      middleware.handle,
      requireScopedPermission("page", "read", "members"),
      this.list.bind(this),
    );
    this.router.get(
      "/:id/collaborator-candidates",
      middleware.handle,
      requireScopedPermission("page", "write", "add_members"),
      this.listCandidates.bind(this),
    );
    this.router.get(
      "/:id/collaborators/:collaboratorId",
      middleware.handle,
      requireScopedPermission("page", "read", "members"),
      this.get.bind(this),
    );
    this.router.post(
      "/:id/collaborators",
      middleware.handle,
      requireScopedPermission("page", "write", "add_members"),
      this.requireInvite.bind(this),
    );
    this.router.delete(
      "/:id/collaborators/:collaboratorId",
      middleware.handle,
      requireScopedPermission("page", "write", "promote_members"),
      this.remove.bind(this),
    );
  }

  private async list(request: Request, response: Response): Promise<Response> {
    const collaborators = await this.collaborators.listCollaborators(routeParam(request, "id"));
    return response.status(StatusCode.OK).json(collaborators ?? []);
  }

  private async listCandidates(request: Request, response: Response): Promise<Response> {
    const result = await this.collaborators.listCandidates(routeParam(request, "id"), request.query.q);
    return result.ok
      ? response.status(StatusCode.OK).json(result.data)
      : sendPageFailure(response, result);
  }

  private async get(request: Request, response: Response): Promise<Response> {
    const result = await this.collaborators.getCollaborator(
      routeParam(request, "id"),
      routeParam(request, "collaboratorId"),
    );
    return result.ok
      ? response.status(StatusCode.OK).json(result.data)
      : sendPageFailure(response, result);
  }

  private requireInvite(_request: Request, response: Response): Response {
    return response.status(StatusCode.CONFLICT).json({
      message: "A entrada exige aceite. Use POST /access/page/:id/invites com e-mail ou link.",
    });
  }

  private async remove(request: Request, response: Response): Promise<Response> {
    const result = await this.collaborators.removeCollaborator(
      routeParam(request, "id"),
      authenticatedUserId(request),
      routeParam(request, "collaboratorId"),
    );
    return result.ok
      ? response.status(StatusCode.NO_CONTENT).send()
      : sendPageFailure(response, result);
  }
}
