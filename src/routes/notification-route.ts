import type { Request, Response } from 'express';

import notificationController, { NotificationController } from '@/controllers/notification-controller';
import { ApplicationRouter } from '@/routes/application-router';
import { authenticatedUserId, routeParam } from '@/routes/request-values';
import middleware from '@/services/auth/middleware';
import { requireScopedPermission } from '@/services/auth/scoped-access-middleware';
import { StatusCode } from '@/services/http/status-code';

const FAILURE_STATUS = {
  not_found: StatusCode.NOT_FOUND,
  validation: StatusCode.BAD_REQUEST,
  forbidden: StatusCode.FORBIDDEN,
  conflict: StatusCode.CONFLICT,
  server_error: StatusCode.INTERNAL_SERVER_ERROR,
} as const;

export class NotificationRouter extends ApplicationRouter {
  public constructor(private readonly notifications: NotificationController = notificationController) {
    super(middleware.handle);
  }

  protected registerRoutes(): void {
    const canReadWorkspace = requireScopedPermission('workspace', 'read', 'view', 'workspaceId');
    this.router.get('/:workspaceId', canReadWorkspace, this.list.bind(this));
    this.router.put(
      '/:workspaceId/:notificationId/read',
      canReadWorkspace,
      this.markRead.bind(this),
    );
  }

  private async list(request: Request, response: Response): Promise<Response> {
    const result = await this.notifications.list(
      routeParam(request, 'workspaceId'),
      authenticatedUserId(request),
    );
    return result.ok
      ? response.status(StatusCode.OK).json(result.data)
      : response.status(FAILURE_STATUS[result.reason]).json({ message: result.message });
  }

  private async markRead(request: Request, response: Response): Promise<Response> {
    const result = await this.notifications.markRead(
      routeParam(request, 'workspaceId'),
      routeParam(request, 'notificationId'),
      authenticatedUserId(request),
    );
    return result.ok
      ? response.status(StatusCode.NO_CONTENT).send()
      : response.status(FAILURE_STATUS[result.reason]).json({ message: result.message });
  }
}

export default new NotificationRouter().build();
