import type { Request, Response } from "express";
import pageColumnController, {
  PageColumnController,
} from "@/controllers/page-column-controller";
import pageColumnResetController, {
  PageColumnResetController,
} from "@/controllers/page-column-reset-controller";
import type { Input } from "@/db/schemas/inputs";
import type { Schema } from "@/db/schemas/index";
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

/** Fronteira HTTP das colunas pertencentes a uma página parent. */
export class PageColumnRouter extends ApplicationRouter {
  public constructor(
    private readonly columns: PageColumnController = pageColumnController,
    private readonly reset: PageColumnResetController = pageColumnResetController,
    private readonly realtime: PageRealtimePublisher = pageRealtimePublisher,
  ) {
    super();
  }

  protected registerRoutes(): void {
    this.router.post(
      "/parent/:id/columns",
      middleware.handle,
      requireScopedPermission("page", "write", "update"),
      this.create.bind(this),
    );
    this.router.get(
      "/parent/:id/columns",
      middleware.handle,
      requirePageAccess(),
      this.list.bind(this),
    );
    this.router.get(
      "/parent/:id/columns/:column_id",
      middleware.handle,
      requirePageAccess(),
      this.get.bind(this),
    );
    this.router.put(
      "/parent/:id/columns/:column_id",
      middleware.handle,
      requireScopedPermission("page", "write", "update"),
      requireUnlockedColumn('id'),
      this.update.bind(this),
    );
    this.router.post(
      "/parent/:id/columns/:column_id/reset",
      middleware.handle,
      requireScopedPermission("page", "write", "update"),
      requireUnlockedColumn('id'),
      this.resetColumn.bind(this),
    );
    this.router.delete(
      "/parent/:id/columns/:column_id",
      middleware.handle,
      requireScopedPermission("page", "write", "update"),
      requireUnlockedColumn('id'),
      this.delete.bind(this),
    );
  }

  private async create(request: Request, response: Response): Promise<Response> {
    const body = (request.body ?? {}) as Input.CreatePageColumn;
    const type = this.typeFromQuery(request.query.type);
    if (type === null) {
      return response.status(StatusCode.BAD_REQUEST).json({ message: "Tipo de coluna não suportado" });
    }

    const pageId = routeParam(request, "id");
    const result = await this.columns.createColumn({
      ...(body.name !== undefined && { name: body.name }),
      ...(body.options !== undefined && { options: body.options }),
      ...(body.format !== undefined && { format: body.format }),
      ...(body.currency !== undefined && { currency: body.currency }),
      ...(body.mask !== undefined && { mask: body.mask }),
      ...(body.flowButton !== undefined && { flowButton: body.flowButton }),
      ...(type !== undefined ? { type } : body.type !== undefined ? { type: body.type } : {}),
      parent_id: pageId,
    });
    if (!result.ok) return sendPageFailure(response, result);

    await this.realtime.columnCreated({
      pageId,
      columnId: result.data.id,
      column: result.data,
      originUserId: authenticatedUserId(request),
    });
    return response.status(StatusCode.CREATED).json(result.data);
  }

  private async list(request: Request, response: Response): Promise<Response> {
    const columns = await this.columns.listColumns({
      parent_id: routeParam(request, "id"),
    } as LookupsConfig<Schema.PageColumn>);
    return response.status(StatusCode.OK).json(columns ?? []);
  }

  private async get(request: Request, response: Response): Promise<Response> {
    const column = await this.columns.getColumn(this.lookup(request));
    return column
      ? response.status(StatusCode.OK).json(column)
      : response.status(StatusCode.NOT_FOUND).json({ message: '"Page_column" não encontrado' });
  }

  private async update(request: Request, response: Response): Promise<Response> {
    const body = (request.body ?? {}) as Input.UpdatePageColumn;
    const type = this.typeFromQuery(request.query.type);
    if (type === null) {
      return response.status(StatusCode.BAD_REQUEST).json({ message: "Tipo de coluna não suportado" });
    }

    const input: Input.UpdatePageColumn = {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.options !== undefined && { options: body.options }),
      ...(body.format !== undefined && { format: body.format }),
      ...(body.currency !== undefined && { currency: body.currency }),
      ...(body.mask !== undefined && { mask: body.mask }),
      ...(body.flowButton !== undefined && { flowButton: body.flowButton }),
      ...(type !== undefined ? { type } : body.type !== undefined ? { type: body.type } : {}),
    };
    const result = await this.columns.updateColumn(this.lookup(request), input);
    if (!result.ok) return sendPageFailure(response, result);

    const pageId = routeParam(request, "id");
    const columnId = routeParam(request, "column_id");
    await this.realtime.columnUpdated({
      pageId,
      columnId,
      column: result.data,
      originUserId: authenticatedUserId(request),
    });
    return response.status(StatusCode.OK).json(result.data);
  }

  private async resetColumn(request: Request, response: Response): Promise<Response> {
    const result = await this.reset.resetColumn(this.lookup(request));
    if (!result.ok) return sendPageFailure(response, result);

    const pageId = routeParam(request, "id");
    const columnId = routeParam(request, "column_id");
    await this.realtime.columnReset({
      pageId,
      columnId,
      column: result.data.column,
      cells: result.data.resetCells,
      originUserId: authenticatedUserId(request),
    });
    return response.status(StatusCode.OK).json(result.data.column);
  }

  private async delete(request: Request, response: Response): Promise<Response> {
    const result = await this.columns.deleteColumn(this.lookup(request));
    if (!result.ok) return sendPageFailure(response, result);

    await this.realtime.columnDeleted({
      pageId: routeParam(request, "id"),
      columnId: routeParam(request, "column_id"),
      originUserId: authenticatedUserId(request),
    });
    return response.status(StatusCode.NO_CONTENT).send();
  }

  private lookup(request: Request): LookupValues<Schema.PageColumn> {
    return {
      id: routeParam(request, "column_id"),
      parent_id: routeParam(request, "id"),
    } as LookupValues<Schema.PageColumn>;
  }

  private typeFromQuery(raw: unknown): Schema.ColumnType | undefined | null {
    if (typeof raw !== "string") return undefined;
    if (raw === "number") return "numeric";
    if (raw === "text" || raw === "numeric" || raw === "select" || raw === "date" || raw === "checkbox" || raw === "flow") {
      return raw;
    }
    return null;
  }
}
