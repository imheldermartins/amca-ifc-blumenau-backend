import type { Request, Response } from "express";
import workspacesController from "@/controllers/workspaces-controller";
import type { WorkspaceMutationResult } from "@/controllers/types/workspace-controller.types";
import type { Input } from "@/db/schemas/inputs";
import { ApplicationRouter } from "@/routes/application-router";
import middleware from "@/services/auth/middleware";
import { requireWorkspaceAbility } from "@/services/auth/workspace-access-middleware";
import { StatusCode } from "@/services/http/status-code";
import pageRelationRepository, { PageRelationError } from '@/repositories/page-relation-repository';

export class WorkspaceRouter extends ApplicationRouter {
  public constructor() {
    super(middleware.handle);
  }

  protected registerRoutes(): void {
    this.router.get("/", this.list.bind(this));
    this.router.post("/", this.create.bind(this));
    this.router.get("/:id/relation-databases", requireWorkspaceAbility("read", "Workspace"), this.listRelationDatabases.bind(this));
    this.router.get("/:id/page_root", requireWorkspaceAbility("read", "WorkspaceRoot"), this.getPageRoot.bind(this));
    this.router.get("/:id/members", requireWorkspaceAbility("read", "WorkspaceMembers"), this.listMembers.bind(this));
    this.router.put("/:id/members/:userId/role", requireWorkspaceAbility("manage", "WorkspaceMembers"), this.updateMemberRole.bind(this));
    this.router.get("/:id", requireWorkspaceAbility("read", "Workspace"), this.get.bind(this));
    this.router.put("/:id", requireWorkspaceAbility("manage", "WorkspaceSettings"), this.update.bind(this));
  }

  private async list(req: Request, res: Response): Promise<Response> {
    const workspaces = await workspacesController.listForUser(req.userId as string);
    return workspaces
      ? res.status(StatusCode.OK).json(workspaces)
      : res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Erro no servidor" });
  }

  private async create(req: Request, res: Response): Promise<Response> {
    const { name, organizationId } = (req.body ?? {}) as Input.CreateWorkspace;
    const result = await workspacesController.createInOrganization(req.userId as string, { name, organizationId });
    return this.sendMutation(res, result, StatusCode.CREATED);
  }

  private async getPageRoot(req: Request, res: Response): Promise<Response> {
    const root = await workspacesController.getPageRoot(req.params.id as string, req.userId as string);
    return root
      ? res.status(StatusCode.OK).json(root)
      : res.status(StatusCode.NOT_FOUND).json({ message: '"Workspace" não encontrado' });
  }

  private async listRelationDatabases(req: Request, res: Response): Promise<Response> {
    try {
      const result = await pageRelationRepository.listDatabases(
        req.params.id as string,
        req.userId as string,
        typeof req.query.search === 'string' ? req.query.search : undefined,
        typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
        typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined,
      );
      return res.status(StatusCode.OK).json(result);
    } catch (error) {
      if (error instanceof PageRelationError) return res.status(error.status).json({ message: error.message });
      console.error(error);
      return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: 'Erro no servidor' });
    }
  }

  private async listMembers(req: Request, res: Response): Promise<Response> {
    const members = await workspacesController.listMembers(req.params.id as string);
    return members
      ? res.status(StatusCode.OK).json(members)
      : res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Erro no servidor" });
  }

  private async updateMemberRole(req: Request, res: Response): Promise<Response> {
    const result = await workspacesController.updateMemberRole(
      req.params.id as string,
      req.userId as string,
      req.params.userId as string,
      req.body?.roleId ?? req.body?.role,
    );
    return this.sendMutation(res, result, StatusCode.OK);
  }

  private async get(req: Request, res: Response): Promise<Response> {
    const workspace = await workspacesController.getForUser(req.params.id as string, req.userId as string);
    return workspace
      ? res.status(StatusCode.OK).json(workspace)
      : res.status(StatusCode.NOT_FOUND).json({ message: '"Workspace" não encontrado' });
  }

  private async update(req: Request, res: Response): Promise<Response> {
    const { name, icon } = (req.body ?? {}) as Input.UpdateWorkspace;
    const result = await workspacesController.updateSettings(
      req.params.id as string,
      req.userId as string,
      { name, icon },
    );
    return this.sendMutation(res, result, StatusCode.OK);
  }

  private sendMutation<T>(res: Response, result: WorkspaceMutationResult<T>, successStatus: number): Response {
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

export default new WorkspaceRouter().build();
