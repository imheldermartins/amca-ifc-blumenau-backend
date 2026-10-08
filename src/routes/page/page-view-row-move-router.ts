import type {Request, Response} from 'express';
import controller, {PageViewRowMoveController} from '@/controllers/page-view-row-move-controller';
import {ApplicationRouter} from '@/routes/application-router';
import {authenticatedUserId, routeParam} from '@/routes/request-values';
import {sendPageFailure} from '@/routes/page/page-route-responder';
import middleware from '@/services/auth/middleware';
import {requireScopedPermission} from '@/services/auth/scoped-access-middleware';
import realtime, {PageRealtimePublisher} from '@/services/realtime/page-realtime-publisher';
import {StatusCode} from '@/services/http/status-code';
import {isJsonRecord} from '@/services/pages/views/page-view-parsers';

export class PageViewRowMoveRouter extends ApplicationRouter {
  constructor(private readonly positions: PageViewRowMoveController = controller,
    private readonly publisher: PageRealtimePublisher = realtime) { super(); }
  protected registerRoutes(): void {
    this.router.post('/:id/views/:viewId/rows/:rowId/move', middleware.handle,
      requireScopedPermission('page', 'write', 'update'), this.move.bind(this));
  }
  private async move(request: Request, response: Response): Promise<Response> {
    const rowId = routeParam(request, 'rowId');
    if (!isJsonRecord(request.body) || (request.body.rowId !== undefined && request.body.rowId !== rowId)) {
      return response.status(StatusCode.BAD_REQUEST).json({message: 'Movimento de página inválido'});
    }
    const pageId = routeParam(request, 'id'), viewId = routeParam(request, 'viewId'), userId = authenticatedUserId(request);
    const result = await this.positions.move(pageId, viewId, userId, {...request.body, rowId});
    if (!result.ok) {
      if (result.reason === 'conflict' && result.confirmed) return response.status(StatusCode.CONFLICT).json({message: result.message, confirmed: result.confirmed});
      return sendPageFailure(response, result);
    }
    if (Object.prototype.hasOwnProperty.call(request.body, 'targetOptionId') && result.data.selectColumnId) {
      await this.publisher.cellUpdated({rowId, columnId: result.data.selectColumnId, columnType: 'select', value: result.data.optionId ?? null, originUserId: userId});
    }
    await this.publisher.rowOrderUpdated(pageId, viewId, rowId, result.data.orderRevision, userId);
    return response.status(StatusCode.OK).json(result.data);
  }
}
