import type { Request, Response } from "express";
import pageViewController, {
  PageViewController,
} from "@/controllers/page-view-controller";
import pageViewPatchController, {
  PageViewPatchController,
} from "@/controllers/page-view-patch-controller";
import { ApplicationRouter } from "@/routes/application-router";
import { sendPageFailure } from "@/routes/page/page-route-responder";
import { authenticatedUserId, routeParam } from "@/routes/request-values";
import middleware from "@/services/auth/middleware";
import { requireScopedPermission } from "@/services/auth/scoped-access-middleware";
import { StatusCode } from "@/services/http/status-code";
import pageRealtimePublisher, {
  PageRealtimePublisher,
} from "@/services/realtime/page-realtime-publisher";

/** Fronteira HTTP do ciclo de vida e da configuração de views. */
export class PageViewRouter extends ApplicationRouter {
  public constructor(
    private readonly views: PageViewController = pageViewController,
    private readonly patches: PageViewPatchController = pageViewPatchController,
    private readonly realtime: PageRealtimePublisher = pageRealtimePublisher,
  ) {
    super();
  }

  protected registerRoutes(): void {
    const canUpdate = requireScopedPermission("page", "write", "update");
    this.router.post("/:id/views", middleware.handle, canUpdate, this.create.bind(this));
    this.router.post(
      "/:id/views/:viewId/duplicate",
      middleware.handle,
      canUpdate,
      this.duplicate.bind(this),
    );
    this.router.put("/:id/views/order", middleware.handle, canUpdate, this.reorder.bind(this));
    this.router.put(
      "/:id/views/:viewId/filters",
      middleware.handle,
      canUpdate,
      this.updateFilters.bind(this),
    );
    this.router.patch(
      "/:id/views/:viewId",
      middleware.handle,
      canUpdate,
      this.patch.bind(this),
    );
    this.router.delete(
      "/:id/views/:viewId",
      middleware.handle,
      canUpdate,
      this.delete.bind(this),
    );
  }

  private async create(request: Request, response: Response): Promise<Response> {
    const pageId = routeParam(request, "id");
    const result = await this.views.createView(pageId, request.body, request.query.type);
    if (!result.ok) return sendPageFailure(response, result);

    await this.publish(request, result.data.data);
    return response.status(StatusCode.CREATED).json({
      viewId: result.data.viewId,
      view: result.data.view,
    });
  }

  private async duplicate(request: Request, response: Response): Promise<Response> {
    const result = await this.views.duplicateView(
      routeParam(request, "id"),
      routeParam(request, "viewId"),
    );
    if (!result.ok) return sendPageFailure(response, result);

    await this.publish(request, result.data.data);
    return response.status(StatusCode.CREATED).json({
      viewId: result.data.viewId,
      view: result.data.view,
    });
  }

  private async reorder(request: Request, response: Response): Promise<Response> {
    const result = await this.views.reorderViews(routeParam(request, "id"), request.body);
    if (!result.ok) return sendPageFailure(response, result);

    if (result.data.changed) await this.publish(request, result.data.data);
    return response.status(StatusCode.OK).json({ viewIds: result.data.viewIds });
  }

  private async updateFilters(request: Request, response: Response): Promise<Response> {
    const result = await this.patches.updateFilters(
      routeParam(request, "id"),
      routeParam(request, "viewId"),
      request.body,
    );
    if (!result.ok) return sendPageFailure(response, result);

    await this.publish(request, result.data.data);
    return response.status(StatusCode.OK).json({
      viewId: result.data.viewId,
      filters: result.data.filters,
    });
  }

  private async patch(request: Request, response: Response): Promise<Response> {
    const result = await this.patches.patchView(
      routeParam(request, "id"),
      routeParam(request, "viewId"),
      request.body,
    );
    if (!result.ok) return sendPageFailure(response, result);

    if (result.data.changed) await this.publish(request, result.data.data);
    return response.status(StatusCode.OK).json({
      viewId: result.data.viewId,
      view: result.data.view,
    });
  }

  private async delete(request: Request, response: Response): Promise<Response> {
    const result = await this.views.deleteView(
      routeParam(request, "id"),
      routeParam(request, "viewId"),
    );
    if (!result.ok) return sendPageFailure(response, result);

    await this.publish(request, result.data.data);
    return response.status(StatusCode.NO_CONTENT).send();
  }

  private publish(request: Request, data: Record<string, unknown>): Promise<void> {
    return this.realtime.pageChanged({
      pageId: routeParam(request, "id"),
      data,
      originUserId: authenticatedUserId(request),
    });
  }
}
