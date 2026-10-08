import type { Request, Response } from 'express';

import flowController, { FlowController } from '@/controllers/flow-controller';
import flowStore, { FlowStore } from '@/repositories/flow-repository';
import { ApplicationRouter } from '@/routes/application-router';
import { sendPageFailure } from '@/routes/page/page-route-responder';
import { authenticatedUserId, routeParam } from '@/routes/request-values';
import { requireUnlockedColumn } from '@/services/auth/column-lock-middleware';
import middleware from '@/services/auth/middleware';
import { requirePageAccess } from '@/services/auth/page-access-middleware';
import { requireScopedPermission } from '@/services/auth/scoped-access-middleware';
import { StatusCode } from '@/services/http/status-code';
import pageRealtimePublisher, { PageRealtimePublisher } from '@/services/realtime/page-realtime-publisher';

export class PageFlowRouter extends ApplicationRouter {
  public constructor(
    private readonly flows: FlowController = flowController,
    private readonly store: FlowStore = flowStore,
    private readonly realtime: PageRealtimePublisher = pageRealtimePublisher,
  ) {
    super();
  }

  protected registerRoutes(): void {
    this.router.get(
      '/parent/:id/columns/:column_id/flow',
      middleware.handle,
      requirePageAccess(),
      this.getConfiguration.bind(this),
    );
    this.router.put(
      '/parent/:id/columns/:column_id/flow',
      middleware.handle,
      requireScopedPermission('page', 'write', 'update'),
      requireUnlockedColumn('id'),
      this.saveConfiguration.bind(this),
    );
    this.router.get(
      '/parent/:id/columns/:column_id/flow/macros',
      middleware.handle,
      requirePageAccess(),
      this.listMacros.bind(this),
    );
    this.router.post(
      '/:id/column/:column_id/flow/execute',
      middleware.handle,
      requireScopedPermission('page', 'write', 'update'),
      requireUnlockedColumn(),
      this.execute.bind(this),
    );
  }

  private async getConfiguration(request: Request, response: Response): Promise<Response> {
    const result = await this.flows.getConfiguration(
      routeParam(request, 'id'),
      routeParam(request, 'column_id'),
    );
    return result.ok
      ? response.status(StatusCode.OK).json(result.data)
      : sendPageFailure(response, result);
  }

  private async saveConfiguration(request: Request, response: Response): Promise<Response> {
    const parentId = routeParam(request, 'id');
    const columnId = routeParam(request, 'column_id');
    const result = await this.flows.saveConfiguration(
      parentId,
      columnId,
      authenticatedUserId(request),
      request.body,
    );
    if (!result.ok) return sendPageFailure(response, result);
    const column = await this.store.findFlowColumn(parentId, columnId);
    if (column) {
      await this.realtime.columnUpdated({
        pageId: parentId,
        columnId,
        column,
        originUserId: authenticatedUserId(request),
      });
    }
    return response.status(StatusCode.OK).json(result.data);
  }

  private async listMacros(request: Request, response: Response): Promise<Response> {
    const rowId = typeof request.query.rowId === 'string' && request.query.rowId
      ? request.query.rowId as NonEmptyString
      : undefined;
    const result = await this.flows.listMacros(
      routeParam(request, 'id'),
      routeParam(request, 'column_id'),
      rowId,
    );
    return result.ok
      ? response.status(StatusCode.OK).json(result.data)
      : sendPageFailure(response, result);
  }

  private async execute(request: Request, response: Response): Promise<Response> {
    const rowId = routeParam(request, 'id');
    const columnId = routeParam(request, 'column_id');
    const actorId = authenticatedUserId(request);
    const result = await this.flows.execute(rowId, columnId, actorId);
    if (!result.ok) return sendPageFailure(response, result);

    for (const value of result.data.updatedValues) {
      await this.realtime.cellUpdated({
        rowId,
        columnId: value.columnId,
        columnType: value.columnType,
        value: value.value,
        originUserId: actorId,
      });
    }
    await this.realtime.cellUpdated({
      rowId,
      columnId,
      columnType: 'flow',
      value: result.data.summary,
      originUserId: actorId,
    });
    return response.status(StatusCode.OK).json({ ...result.data.summary, updatedValues: result.data.updatedValues });
  }
}

export default new PageFlowRouter();

