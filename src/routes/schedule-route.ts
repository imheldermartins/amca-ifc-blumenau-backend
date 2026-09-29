import type { Request, Response } from "express";

import scheduleController, { ScheduleController } from "@/controllers/schedule-controller";
import type { Input } from "@/db/schemas/inputs";
import { ApplicationRouter } from "@/routes/application-router";
import { authenticatedUserId, routeParam } from "@/routes/request-values";
import middleware from "@/services/auth/middleware";
import { requireScopedPermission } from "@/services/auth/scoped-access-middleware";
import { StatusCode } from "@/services/http/status-code";

const FAILURE_STATUS = {
  not_found: StatusCode.NOT_FOUND,
  validation: StatusCode.BAD_REQUEST,
  forbidden: StatusCode.FORBIDDEN,
  conflict: StatusCode.CONFLICT,
  server_error: StatusCode.INTERNAL_SERVER_ERROR,
} as const;

export class ScheduleRouter extends ApplicationRouter {
  public constructor(private readonly schedule: ScheduleController = scheduleController) {
    super(middleware.handle);
  }

  protected registerRoutes(): void {
    const canReadWorkspace = requireScopedPermission(
      "workspace",
      "read",
      "view",
      "workspaceId",
    );
    this.router.get(
      "/:workspaceId/pinned-pages",
      canReadWorkspace,
      this.list.bind(this),
    );
    this.router.put(
      "/:workspaceId/pinned-pages/:pageId",
      canReadWorkspace,
      this.pin.bind(this),
    );
    this.router.delete(
      "/:workspaceId/pinned-pages/:pageId",
      canReadWorkspace,
      this.unpin.bind(this),
    );
  }

  private async list(request: Request, response: Response): Promise<Response> {
    const result = await this.schedule.list(
      routeParam(request, "workspaceId"),
      authenticatedUserId(request),
    );
    return result.ok
      ? response.status(StatusCode.OK).json(result.data)
      : response.status(FAILURE_STATUS[result.reason]).json({ message: result.message });
  }

  private async pin(request: Request, response: Response): Promise<Response> {
    const result = await this.schedule.pin(
      routeParam(request, "workspaceId"),
      routeParam(request, "pageId"),
      authenticatedUserId(request),
      (request.body ?? {}) as Input.PinSchedulePage,
    );
    return result.ok
      ? response.status(StatusCode.OK).json(result.data)
      : response.status(FAILURE_STATUS[result.reason]).json({ message: result.message });
  }

  private async unpin(request: Request, response: Response): Promise<Response> {
    const result = await this.schedule.unpin(
      routeParam(request, "workspaceId"),
      routeParam(request, "pageId"),
      authenticatedUserId(request),
    );
    return result.ok
      ? response.status(StatusCode.NO_CONTENT).send()
      : response.status(FAILURE_STATUS[result.reason]).json({ message: result.message });
  }
}

export default new ScheduleRouter().build();
