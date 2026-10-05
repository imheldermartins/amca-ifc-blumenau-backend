import type { Request, Response } from 'express';

import pageDocumentController, { PageDocumentController } from '@/controllers/page-document-controller';
import { ApplicationRouter } from '@/routes/application-router';
import { routeParam } from '@/routes/request-values';
import middleware from '@/services/auth/middleware';
import { requireScopedPermission } from '@/services/auth/scoped-access-middleware';
import { StatusCode } from '@/services/http/status-code';

export class PageDocumentRouter extends ApplicationRouter {
  public constructor(private readonly documents: PageDocumentController = pageDocumentController) { super(); }

  protected registerRoutes(): void {
    this.router.get('/:id/document', middleware.handle, requireScopedPermission('page', 'read', 'view'), this.get.bind(this));
    this.router.put('/:id/document', middleware.handle, requireScopedPermission('page', 'write', 'update'), this.save.bind(this));
  }

  private async get(request: Request, response: Response) {
    const result = await this.documents.get(routeParam(request, 'id'));
    if (!result.ok) return response.status(result.reason === 'validation' ? StatusCode.BAD_REQUEST : StatusCode.INTERNAL_SERVER_ERROR).json({ message: result.message });
    return response.status(StatusCode.OK).json(result.data ?? { content: null, revision: 0 });
  }

  private async save(request: Request, response: Response) {
    const result = await this.documents.save(routeParam(request, 'id'), request.body);
    if (!result.ok) {
      const status = result.reason === 'validation' ? StatusCode.BAD_REQUEST
        : result.reason === 'not_found' ? StatusCode.NOT_FOUND
          : StatusCode.INTERNAL_SERVER_ERROR;
      return response.status(status).json({ message: result.message });
    }
    return response.status(StatusCode.OK).json(result.data);
  }
}
