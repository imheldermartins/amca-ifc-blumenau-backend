import formService, { FormError, FormService } from '@/services/forms/form-service';

export type PageFormResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: FormError['reason']; message: string };

export class PageFormController {
  public constructor(private readonly forms: FormService = formService) {}

  public status(pageId: string, viewId: string) {
    return this.run(() => this.forms.publicationStatus(pageId, viewId));
  }

  public publish(pageId: string, viewId: string, userId: string, body: unknown) {
    const expiresAt = body && typeof body === 'object' && 'expiresAt' in body
      ? (body as { expiresAt?: unknown }).expiresAt
      : null;
    return this.run(() => this.forms.publish(pageId, viewId, userId, expiresAt));
  }

  public revoke(pageId: string, viewId: string) {
    return this.run(() => this.forms.revoke(pageId, viewId));
  }

  public definition(publicationId: string, capability: unknown) {
    return this.run(() => this.forms.publicDefinition(publicationId, capability));
  }

  public submitPublic(publicationId: string, capability: unknown, requestId: unknown, body: unknown) {
    return this.run(() => this.forms.submitPublic(publicationId, capability, requestId, body));
  }

  public submitAuthenticated(
    pageId: string,
    viewId: string,
    userId: string,
    requestId: unknown,
    body: unknown,
  ) {
    return this.run(() => this.forms.submitAuthenticated(pageId, viewId, userId, requestId, body));
  }

  public review(publicationId: string, capability: unknown, cursor: string | undefined, limit: unknown) {
    return this.run(() => this.forms.review(publicationId, capability, cursor, limit));
  }

  private async run<T>(operation: () => Promise<T>): Promise<PageFormResult<T>> {
    try {
      return { ok: true, data: await operation() };
    } catch (error) {
      if (error instanceof FormError) {
        return { ok: false, reason: error.reason, message: error.message };
      }
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return { ok: false, reason: 'server_error', message: 'Erro no servidor' };
    }
  }
}

export default new PageFormController();
