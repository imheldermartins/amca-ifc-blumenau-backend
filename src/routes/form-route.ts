import type { Request, Response } from 'express';

import pageFormController, { PageFormController, type PageFormResult } from '@/controllers/page-form-controller';
import { ApplicationRouter } from '@/routes/application-router';
import { routeParam } from '@/routes/request-values';
import { formReadRateLimit, formSubmitRateLimit } from '@/services/http/rate-limit.config';
import { StatusCode } from '@/services/http/status-code';
import pageRealtimePublisher, { PageRealtimePublisher } from '@/services/realtime/page-realtime-publisher';

const STATUS_BY_REASON = {
  validation: StatusCode.BAD_REQUEST,
  forbidden: StatusCode.FORBIDDEN,
  not_found: StatusCode.NOT_FOUND,
  conflict: StatusCode.CONFLICT,
  server_error: StatusCode.INTERNAL_SERVER_ERROR,
} as const;

export class FormRouter extends ApplicationRouter {
  public constructor(
    private readonly forms: PageFormController = pageFormController,
    private readonly realtime: PageRealtimePublisher = pageRealtimePublisher,
  ) { super(); }

  protected registerRoutes(): void {
    this.router.get('/publications/:publicationId', formReadRateLimit, this.definition.bind(this));
    this.router.post('/publications/:publicationId/submissions', formSubmitRateLimit, this.submit.bind(this));
    this.router.get('/publications/:publicationId/submissions', formReadRateLimit, this.review.bind(this));
  }

  private capability(request: Request): string | undefined {
    return request.header('X-Cubs-Form-Capability');
  }

  private async definition(request: Request, response: Response) {
    return this.send(response, await this.forms.definition(
      routeParam(request, 'publicationId'),
      this.capability(request),
    ));
  }

  private async submit(request: Request, response: Response) {
    const result = await this.forms.submitPublic(
      routeParam(request, 'publicationId'),
      this.capability(request),
      request.header('Idempotency-Key'),
      request.body,
    );
    if (!result.ok) return this.send(response, result);
    if (result.data.realtime) await this.realtime.rowCreated(result.data.realtime);
    return response.status(StatusCode.CREATED).json(result.data.result);
  }

  private async review(request: Request, response: Response) {
    return this.send(response, await this.forms.review(
      routeParam(request, 'publicationId'),
      this.capability(request),
      typeof request.query.cursor === 'string' ? request.query.cursor : undefined,
      request.query.limit,
    ));
  }

  private send<T>(response: Response, result: PageFormResult<T>, success: number = StatusCode.OK) {
    return result.ok
      ? response.status(success).json(result.data)
      : response.status(STATUS_BY_REASON[result.reason]).json({ message: result.message });
  }
}

export default new FormRouter().build();
