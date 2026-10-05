import type { Request, Response } from 'express';
import controller, { PageViewQueryController } from '@/controllers/page-view-query-controller';
import { ApplicationRouter } from '@/routes/application-router';
import { authenticatedUserId, routeParam } from '@/routes/request-values';
import middleware from '@/services/auth/middleware';
import { requirePageAccess } from '@/services/auth/page-access-middleware';
import { StatusCode } from '@/services/http/status-code';

export class PageViewQueryRouter extends ApplicationRouter {
  constructor(private readonly queries: PageViewQueryController = controller) { super(); }
  protected registerRoutes(): void {
    this.router.get('/:id/view-metadata', middleware.handle, requirePageAccess(), this.metadata.bind(this));
    this.router.post('/:id/views/:viewId/query', middleware.handle, requirePageAccess(), this.query.bind(this));
  }
  private async metadata(request: Request, response: Response): Promise<Response> {
    const result = await this.queries.metadata(routeParam(request, 'id'), authenticatedUserId(request));
    return result.ok ? response.status(StatusCode.OK).json(result.data) : response.status(result.status).json({ message: result.message, ...('code' in result && { code: result.code }) });
  }
  private async query(request: Request, response: Response): Promise<Response> {
    const result = await this.queries.query(routeParam(request, 'id'), routeParam(request, 'viewId'), authenticatedUserId(request), request.body ?? {});
    return result.ok ? response.status(StatusCode.OK).json(result.data) : response.status(result.status).json({ message: result.message, ...('code' in result && { code: result.code }) });
  }
}
