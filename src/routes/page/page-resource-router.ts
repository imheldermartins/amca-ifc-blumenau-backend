import type { Request, Response } from "express";
import pageController, { PageController } from "@/controllers/page-controller";
import pageAccessController, { PageAccessController } from "@/controllers/page-access-controller";
import pageHierarchyController, {
  PageHierarchyController,
} from "@/controllers/page-hierarchy-controller";
import type { Schema } from "@/db/schemas/index";
import type { Input } from "@/db/schemas/inputs";
import { BaseRouter } from "@/routes/base-router";
import { authenticatedUserId, routeParam } from "@/routes/request-values";
import middleware from "@/services/auth/middleware";
import { requirePageAccess } from "@/services/auth/page-access-middleware";
import { requireScopedPermission } from "@/services/auth/scoped-access-middleware";
import pageRealtimePublisher, { PageRealtimePublisher } from "@/services/realtime/page-realtime-publisher";
import { StatusCode } from "@/services/http/status-code";

/** CRUD da própria página; sub-recursos são compostos por PageRouter. */
export class PageResourceRouter extends BaseRouter<Schema.Page> {
  protected readonly resourceName = "Page";

  public constructor(
    private readonly pages: PageController = pageController,
    private readonly access: PageAccessController = pageAccessController,
    private readonly hierarchy: PageHierarchyController = pageHierarchyController,
    private readonly realtime: PageRealtimePublisher = pageRealtimePublisher,
  ) {
    super(pages, {
      all: [middleware.handle],
      get: [middleware.handle, requirePageAccess()],
      create: [middleware.handle],
      update: [middleware.handle, requireScopedPermission("page", "write", "update")],
      delete: [middleware.handle, requireScopedPermission("page", "write", "delete")],
    });
  }

  protected override staticRoutes(): void {
    this.router.get("/shared", middleware.handle, this.listShared.bind(this));
  }

  protected override async all(request: Request, response: Response): Promise<Response> {
    const pages = await this.pages.all({
      owner_id: authenticatedUserId(request),
    } satisfies LookupsConfig<Schema.Page>);
    return response.status(StatusCode.OK).json(pages ?? []);
  }

  protected override async get(request: Request, response: Response): Promise<Response> {
    const page = await this.pages.get({
      id: routeParam(request, "id"),
    } satisfies LookupValues<Schema.Page>);
    if (!page) {
      return response.status(StatusCode.NOT_FOUND).json({ message: '"Page" não encontrado' });
    }

    return response.status(StatusCode.OK).json({
      ...page,
      latest_updated_at: await this.pages.latestUpdatedAt(page.id),
    });
  }

  protected override async create(request: Request, response: Response): Promise<Response> {
    const { title, data } = (request.body ?? {}) as Input.CreatePage;
    const page = await this.pages.create({
      title: title ?? null,
      data: data ?? {},
      owner_id: authenticatedUserId(request),
    } satisfies CreateValues<Schema.Page>);

    return page
      ? response.status(StatusCode.CREATED).json(page)
      : response.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Erro no servidor" });
  }

  protected override async update(request: Request, response: Response): Promise<Response> {
    const { title, data } = (request.body ?? {}) as Input.UpdatePage;
    const pageId = routeParam(request, "id");
    const parentId = await this.hierarchy.getParentId(pageId);
    const page = await this.pages.update(
      { id: pageId } satisfies LookupValues<Schema.Page>,
      {
        ...(title !== undefined && { title }),
        ...(data !== undefined && { data }),
      },
      parentId ? [parentId] : [],
    );

    if (!page) {
      return response.status(StatusCode.NOT_FOUND).json({
        message: '"Page" não encontrado ou falha ao atualizar',
      });
    }

    await this.realtime.pageChanged({
      pageId,
      ...(data !== undefined && { data: page.data }),
      ...(title !== undefined && { title: page.title }),
      originUserId: authenticatedUserId(request),
    });
    return response.status(StatusCode.OK).json(page);
  }

  protected override async delete(request: Request, response: Response): Promise<Response> {
    const pageId = routeParam(request, "id");
    const parentId = await this.hierarchy.getParentId(pageId);
    const deleted = await this.pages.delete(
      { id: pageId } satisfies LookupValues<Schema.Page>,
      parentId ? [parentId] : [],
    );

    if (!deleted) {
      return response.status(StatusCode.NOT_FOUND).json({ message: '"Page" não encontrado' });
    }
    if (parentId) {
      await this.realtime.rowDeleted({
        pageId: parentId,
        rowId: pageId,
        originUserId: authenticatedUserId(request),
      });
    }
    return response.status(StatusCode.NO_CONTENT).send();
  }

  private async listShared(request: Request, response: Response): Promise<Response> {
    const pages = await this.access.listSharedPages(authenticatedUserId(request));
    return response.status(StatusCode.OK).json(pages ?? []);
  }
}
