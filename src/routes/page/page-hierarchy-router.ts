import type { Request, Response } from "express";
import pageHierarchyController, { PageHierarchyController } from "@/controllers/page-hierarchy-controller";
import pageAccessController, { PageAccessController } from "@/controllers/page-access-controller";
import type { Input } from "@/db/schemas/inputs";
import { ApplicationRouter } from "@/routes/application-router";
import { authenticatedUserId, routeParam } from "@/routes/request-values";
import middleware from "@/services/auth/middleware";
import { requirePageAccess } from "@/services/auth/page-access-middleware";
import { requireScopedPermission } from "@/services/auth/scoped-access-middleware";
import pageRealtimePublisher, { PageRealtimePublisher } from "@/services/realtime/page-realtime-publisher";
import { StatusCode } from "@/services/http/status-code";

/** Criação e leitura da árvore de páginas. */
export class PageHierarchyRouter extends ApplicationRouter {
  public constructor(
    private readonly hierarchy: PageHierarchyController = pageHierarchyController,
    private readonly access: PageAccessController = pageAccessController,
    private readonly realtime: PageRealtimePublisher = pageRealtimePublisher,
  ) {
    super();
  }

  protected registerRoutes(): void {
    this.router.post(
      "/:id/page",
      middleware.handle,
      requireScopedPermission("page", "write", "create"),
      this.createChild.bind(this),
    );
    this.router.get("/:id/page", middleware.handle, requirePageAccess(), this.getDataset.bind(this));
    this.router.get("/:id/breadcrumb", middleware.handle, requirePageAccess(), this.getBreadcrumb.bind(this));
  }

  private async createChild(request: Request, response: Response): Promise<Response> {
    const parentId = routeParam(request, "id");
    const userId = authenticatedUserId(request);
    const child = await this.hierarchy.createChild(
      parentId,
      userId,
      (request.body ?? {}) as Input.CreateChildPage,
    );
    if (!child) return response.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Erro no servidor" });

    await this.realtime.rowCreated({
      pageId: parentId,
      rowId: child.id,
      originUserId: userId,
    });
    return response.status(StatusCode.CREATED).json(child);
  }

  private async getDataset(request: Request, response: Response): Promise<Response> {
    const pageId = routeParam(request, "id");
    const userId = authenticatedUserId(request);
    if (!await this.access.canReadSubpages(userId, pageId)) {
      return response.status(StatusCode.OK).json([]);
    }

    const dataset = await this.hierarchy.getDataset(pageId);
    if (!dataset) {
      return response.status(StatusCode.NOT_FOUND).json({ message: '"Page" não encontrado' });
    }

    const visibleRows = await Promise.all(
      dataset.map(async (row) => await this.access.canAccessPage(userId, row.page_id) ? row : null),
    );
    return response.status(StatusCode.OK).json(visibleRows.filter((row) => row !== null));
  }

  private async getBreadcrumb(request: Request, response: Response): Promise<Response> {
    const breadcrumb = await this.hierarchy.getBreadcrumb(routeParam(request, "id"));
    return breadcrumb
      ? response.status(StatusCode.OK).json(breadcrumb)
      : response.status(StatusCode.NOT_FOUND).json({ message: '"Page" não encontrado' });
  }
}
