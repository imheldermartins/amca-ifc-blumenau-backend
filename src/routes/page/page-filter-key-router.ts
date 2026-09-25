import type { Request, Response } from "express";
import pageAccessController, {
  PageAccessController,
} from "@/controllers/page-access-controller";
import pageFilterKeyReconciliationController, {
  PageFilterKeyReconciliationController,
} from "@/controllers/page-filter-key-reconciliation-controller";
import { ApplicationRouter } from "@/routes/application-router";
import { sendPageFailure } from "@/routes/page/page-route-responder";
import { authenticatedUserId, routeParam } from "@/routes/request-values";
import middleware from "@/services/auth/middleware";
import { requirePageAccess } from "@/services/auth/page-access-middleware";
import { StatusCode } from "@/services/http/status-code";
import pageRealtimePublisher, {
  PageRealtimePublisher,
} from "@/services/realtime/page-realtime-publisher";

/** Reconciliação idempotente das chaves públicas de filtros. */
export class PageFilterKeyRouter extends ApplicationRouter {
  public constructor(
    private readonly filterKeys: PageFilterKeyReconciliationController =
      pageFilterKeyReconciliationController,
    private readonly access: PageAccessController = pageAccessController,
    private readonly realtime: PageRealtimePublisher = pageRealtimePublisher,
  ) {
    super();
  }

  protected registerRoutes(): void {
    this.router.post(
      "/:id/filter-keys/reconcile",
      middleware.handle,
      requirePageAccess(),
      this.reconcile.bind(this),
    );
  }

  private async reconcile(request: Request, response: Response): Promise<Response> {
    const pageId = routeParam(request, "id");
    const userId = authenticatedUserId(request);
    if (!await this.access.canUpdatePage(userId, pageId)) {
      const inspected = await this.filterKeys.inspect(pageId);
      return inspected.ok
        ? response.status(StatusCode.OK).json(inspected.data)
        : sendPageFailure(response, inspected);
    }

    const result = await this.filterKeys.reconcile(pageId);
    if (!result.ok) return sendPageFailure(response, result);

    const columnsById = new Map(result.data.columns.map((column) => [String(column.id), column]));
    for (const columnId of result.data.changedColumnIds) {
      const column = columnsById.get(columnId);
      if (!column) continue;
      await this.realtime.columnUpdated({
        pageId,
        columnId,
        column,
        originUserId: userId,
      });
    }
    if (result.data.changedPage) {
      await this.realtime.pageChanged({
        pageId,
        data: result.data.data,
        originUserId: userId,
      });
    }

    return response.status(StatusCode.OK).json({
      pageId: result.data.pageId,
      data: result.data.data,
      columns: result.data.columns,
      catalog: result.data.catalog,
    });
  }
}
