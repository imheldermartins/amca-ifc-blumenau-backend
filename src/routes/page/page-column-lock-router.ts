import type { Request, Response } from 'express';

import columnLockController, { ColumnLockController } from '@/controllers/column-lock-controller';
import { ApplicationRouter } from '@/routes/application-router';
import { sendPageFailure } from '@/routes/page/page-route-responder';
import { authenticatedUserId, routeParam } from '@/routes/request-values';
import middleware from '@/services/auth/middleware';
import { requirePageAccess } from '@/services/auth/page-access-middleware';
import { requireScopedPermission } from '@/services/auth/scoped-access-middleware';
import { StatusCode } from '@/services/http/status-code';

export class PageColumnLockRouter extends ApplicationRouter {
  public constructor(private readonly locks: ColumnLockController = columnLockController) {
    super();
  }

  protected registerRoutes(): void {
    this.router.get(
      '/:id/title-lock',
      middleware.handle,
      requirePageAccess(),
      this.titleStatus.bind(this),
    );
    this.router.get(
      '/:id/column-locks',
      middleware.handle,
      requirePageAccess(),
      this.get.bind(this),
    );
    this.router.put(
      '/:id/column-locks',
      middleware.handle,
      requireScopedPermission('page', 'write', 'lock_columns'),
      this.save.bind(this),
    );
  }

  private async titleStatus(request: Request, response: Response): Promise<Response> {
    const result = await this.locks.titleStatus(
      routeParam(request, 'id'),
      authenticatedUserId(request),
    );
    return result.ok
      ? response.status(StatusCode.OK).json(result.data)
      : sendPageFailure(response, result);
  }

  private async get(request: Request, response: Response): Promise<Response> {
    const result = await this.locks.get(
      routeParam(request, 'id'),
      authenticatedUserId(request),
    );
    return result.ok
      ? response.status(StatusCode.OK).json(result.data)
      : sendPageFailure(response, result);
  }

  private async save(request: Request, response: Response): Promise<Response> {
    const result = await this.locks.save(
      routeParam(request, 'id'),
      authenticatedUserId(request),
      (request.body ?? {}) as { columnKey?: unknown; userIds?: unknown },
    );
    return result.ok
      ? response.status(StatusCode.OK).json(result.data)
      : sendPageFailure(response, result);
  }
}
