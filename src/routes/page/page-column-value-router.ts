import type { Request, Response } from "express";
import pageColumnValueController, {
  PageColumnValueController,
} from "@/controllers/page-column-value-controller";
import type { Input } from "@/db/schemas/inputs";
import { ApplicationRouter } from "@/routes/application-router";
import { sendPageFailure } from "@/routes/page/page-route-responder";
import { authenticatedUserId, routeParam } from "@/routes/request-values";
import middleware from "@/services/auth/middleware";
import { requirePageAccess } from "@/services/auth/page-access-middleware";
import { requireScopedPermission } from "@/services/auth/scoped-access-middleware";
import { requireUnlockedColumn } from '@/services/auth/column-lock-middleware';
import { StatusCode } from "@/services/http/status-code";
import pageRealtimePublisher, {
  PageRealtimePublisher,
} from "@/services/realtime/page-realtime-publisher";

/** Fronteira HTTP da célula singular identificada por página e coluna. */
export class PageColumnValueRouter extends ApplicationRouter {
  public constructor(
    private readonly values: PageColumnValueController = pageColumnValueController,
    private readonly realtime: PageRealtimePublisher = pageRealtimePublisher,
  ) {
    super();
  }

  protected registerRoutes(): void {
    this.router.post(
      "/:id/column/:column_id/value",
      middleware.handle,
      requireScopedPermission("page", "write", "update"),
      requireUnlockedColumn(),
      this.create.bind(this),
    );
    this.router.get(
      "/:id/column/:column_id/value",
      middleware.handle,
      requirePageAccess(),
      this.get.bind(this),
    );
    this.router.put(
      "/:id/column/:column_id/value",
      middleware.handle,
      requireScopedPermission("page", "write", "update"),
      requireUnlockedColumn(),
      this.update.bind(this),
    );
    this.router.delete(
      "/:id/column/:column_id/value",
      middleware.handle,
      requireScopedPermission("page", "write", "update"),
      requireUnlockedColumn(),
      this.delete.bind(this),
    );
  }

  private async create(request: Request, response: Response): Promise<Response> {
    const body = (request.body ?? {}) as Input.UpdatePageColumnValue;
    const result = await this.values.createValue({
      page_id: routeParam(request, "id"),
      page_column_id: routeParam(request, "column_id"),
      ...(body.value !== undefined && { value: body.value }),
      ...(body.startDate !== undefined && { startDate: body.startDate }),
      ...(body.endDate !== undefined && { endDate: body.endDate }),
    });
    if (!result.ok) return sendPageFailure(response, result);

    await this.publish(request, result.data.value);
    return response.status(StatusCode.CREATED).json(result.data);
  }

  private async get(request: Request, response: Response): Promise<Response> {
    const result = await this.values.getValue(
      routeParam(request, "id"),
      routeParam(request, "column_id"),
    );
    return result.ok
      ? response.status(StatusCode.OK).json(result.data)
      : sendPageFailure(response, result);
  }

  private async update(request: Request, response: Response): Promise<Response> {
    const body = (request.body ?? {}) as Input.UpdatePageColumnValue;
    const result = await this.values.updateValue(
      routeParam(request, "id"),
      routeParam(request, "column_id"),
      {
        ...(body.value !== undefined && { value: body.value }),
        ...(body.startDate !== undefined && { startDate: body.startDate }),
        ...(body.endDate !== undefined && { endDate: body.endDate }),
      },
    );
    if (!result.ok) return sendPageFailure(response, result);

    await this.publish(request, result.data.value);
    return response.status(StatusCode.OK).json(result.data);
  }

  private async delete(request: Request, response: Response): Promise<Response> {
    const result = await this.values.deleteValue(
      routeParam(request, "id"),
      routeParam(request, "column_id"),
    );
    if (!result.ok) return sendPageFailure(response, result);

    await this.publish(request, null);
    return response.status(StatusCode.NO_CONTENT).send();
  }

  private publish(request: Request, value: unknown): Promise<void> {
    return this.realtime.cellUpdated({
      rowId: routeParam(request, "id"),
      columnId: routeParam(request, "column_id"),
      value,
      originUserId: authenticatedUserId(request),
    });
  }
}
