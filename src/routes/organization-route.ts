import type { Request, Response } from "express";
import controller from "@controllers/organizations-controller";
import type { OrganizationMutationResult } from "@/controllers/types/organization-controller.types";
import { ApplicationRouter } from "@/routes/application-router";
import middleware from "@/services/auth/middleware";
import { requireScopedPermission } from "@/services/auth/scoped-access-middleware";
import { StatusCode } from "@/services/http/status-code";

export class OrganizationRouter extends ApplicationRouter {
  public constructor() {
    super(middleware.handle);
  }

  protected registerRoutes(): void {
    this.router.get("/", this.list.bind(this));
    this.router.post("/", this.create.bind(this));
    this.router.get("/:id/workspaces", requireScopedPermission("organization", "read", "workspaces"), this.catalog.bind(this));
    this.router.put("/:id/workspaces/:workspaceId", this.linkWorkspace.bind(this));
    this.router.get("/:id", requireScopedPermission("organization", "read", "view"), this.get.bind(this));
    this.router.put("/:id", requireScopedPermission("organization", "write", "update"), this.update.bind(this));
  }

  private async list(req: Request, res: Response): Promise<Response> {
    const organizations = await controller.listForUser(req.userId as string);
    return organizations
      ? res.status(StatusCode.OK).json(organizations)
      : res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Erro no servidor" });
  }

  private async create(req: Request, res: Response): Promise<Response> {
    return this.send(res, await controller.create(req.userId as string, req.body ?? {}), StatusCode.CREATED);
  }

  private async catalog(req: Request, res: Response): Promise<Response> {
    const workspaces = await controller.catalog(req.params.id as string, req.userId as string);
    return workspaces
      ? res.status(StatusCode.OK).json(workspaces)
      : res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Erro no servidor" });
  }

  private async linkWorkspace(req: Request, res: Response): Promise<Response> {
    const result = await controller.linkWorkspace(
      req.params.id as string,
      req.params.workspaceId as string,
      req.userId as string,
    );
    return this.send(res, result, StatusCode.OK);
  }

  private async get(req: Request, res: Response): Promise<Response> {
    const organization = await controller.getForUser(req.params.id as string, req.userId as string);
    return organization
      ? res.status(StatusCode.OK).json(organization)
      : res.status(StatusCode.NOT_FOUND).json({ message: "Organização não encontrada" });
  }

  private async update(req: Request, res: Response): Promise<Response> {
    return this.send(
      res,
      await controller.update(req.params.id as string, req.userId as string, req.body ?? {}),
      StatusCode.OK,
    );
  }

  private send<T>(res: Response, result: OrganizationMutationResult<T>, successStatus: number): Response {
    if (result.ok) return res.status(successStatus).json(result.data);
    const statuses = {
      validation: StatusCode.BAD_REQUEST,
      forbidden: StatusCode.FORBIDDEN,
      conflict: StatusCode.CONFLICT,
      not_found: StatusCode.NOT_FOUND,
      server_error: StatusCode.INTERNAL_SERVER_ERROR,
    } as const;
    return res.status(statuses[result.reason]).json({ message: result.message });
  }
}

export default new OrganizationRouter().build();
