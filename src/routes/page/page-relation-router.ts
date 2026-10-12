import type { Request, Response } from 'express';
import { ApplicationRouter } from '@/routes/application-router';
import { routeParam, authenticatedUserId } from '@/routes/request-values';
import middleware from '@/services/auth/middleware';
import { requirePageAccess } from '@/services/auth/page-access-middleware';
import { StatusCode } from '@/services/http/status-code';
import pageRelationRepository, { PageRelationError } from '@/repositories/page-relation-repository';

export class PageRelationRouter extends ApplicationRouter {
  protected registerRoutes(): void {
    this.router.get('/:id/relation-options', middleware.handle, requirePageAccess(), this.listOptions.bind(this));
  }

  private async listOptions(request: Request, response: Response): Promise<Response> {
    try {
      const result = await pageRelationRepository.listOptions(
        routeParam(request, 'id'),
        authenticatedUserId(request),
        typeof request.query.search === 'string' ? request.query.search : undefined,
        typeof request.query.cursor === 'string' ? request.query.cursor : undefined,
        typeof request.query.limit === 'string' ? Number(request.query.limit) : undefined,
      );
      return response.status(StatusCode.OK).json(result);
    } catch (error) {
      if (error instanceof PageRelationError) return response.status(error.status).json({ message: error.message });
      console.error(error);
      return response.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: 'Erro no servidor' });
    }
  }
}
