import type { Request, Response } from 'express';

import pageFormController, { PageFormController, type PageFormResult } from '@/controllers/page-form-controller';
import { ApplicationRouter } from '@/routes/application-router';
import { authenticatedUserId, routeParam } from '@/routes/request-values';
import middleware from '@/services/auth/middleware';
import { requireScopedPermission } from '@/services/auth/scoped-access-middleware';
import { StatusCode } from '@/services/http/status-code';
import pageRealtimePublisher, { PageRealtimePublisher } from '@/services/realtime/page-realtime-publisher';

const STATUS_BY_REASON = {
  validation: StatusCode.BAD_REQUEST,
  forbidden: StatusCode.FORBIDDEN,
  not_found: StatusCode.NOT_FOUND,
  conflict: StatusCode.CONFLICT,
  server_error: StatusCode.INTERNAL_SERVER_ERROR,
} as const;

export class PageFormRouter extends ApplicationRouter {
  public constructor(
    private readonly forms: PageFormController = pageFormController,
    private readonly realtime: PageRealtimePublisher = pageRealtimePublisher,
  ) { super(); }

  protected registerRoutes(): void {
    const canUpdate = requireScopedPermission('page', 'write', 'update');
    this.router.get('/:id/views/:viewId/form/publication', middleware.handle, canUpdate, this.status.bind(this));
    this.router.post('/:id/views/:viewId/form/publication', middleware.handle, canUpdate, this.publish.bind(this));
    this.router.delete('/:id/views/:viewId/form/publication', middleware.handle, canUpdate, this.revoke.bind(this));
    this.router.post('/:id/views/:viewId/form/submissions', middleware.handle, canUpdate, this.submit.bind(this));
  }

  private async status(request: Request, response: Response) {
    return this.send(response, await this.forms.status(routeParam(request, 'id'), routeParam(request, 'viewId')));
  }

  private async publish(request: Request, response: Response) {
    return this.send(response, await this.forms.publish(
      routeParam(request, 'id'),
      routeParam(request, 'viewId'),
      authenticatedUserId(request),
      request.body,
    ), StatusCode.CREATED);
  }

  private async revoke(request: Request, response: Response) {
    const result = await this.forms.revoke(routeParam(request, 'id'), routeParam(request, 'viewId'));
    if (!result.ok) return this.send(response, result);
    return response.status(StatusCode.NO_CONTENT).send();
  }

  private async submit(request: Request, response: Response) {
    const result = await this.forms.submitAuthenticated(
      routeParam(request, 'id'),
      routeParam(request, 'viewId'),
      authenticatedUserId(request),
      request.header('Idempotency-Key'),
      request.body,
    );
    if (!result.ok) return this.send(response, result);
    if (result.data.realtime) await this.realtime.rowCreated(result.data.realtime);
    return response.status(StatusCode.CREATED).json(result.data.result);
  }

  private send<T>(response: Response, result: PageFormResult<T>, success: number = StatusCode.OK) {
    return result.ok
      ? response.status(success).json(result.data)
      : response.status(STATUS_BY_REASON[result.reason]).json({ message: result.message });
  }
}
