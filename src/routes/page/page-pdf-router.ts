import type { Request, Response } from 'express';
import { ApplicationRouter } from '@/routes/application-router';
import { routeParam } from '@/routes/request-values';
import middleware from '@/services/auth/middleware';
import { requireScopedPermission } from '@/services/auth/scoped-access-middleware';
import pdf, { PagePdfError, PagePdfService } from '@/services/pages/page-pdf-service';
import { isUlid } from '@/services/pages/views/page-view-parsers';

export class PagePdfRouter extends ApplicationRouter {
  public constructor(private readonly service: PagePdfService = pdf) { super(); }
  protected registerRoutes(): void {
    /**
     * @openapi
     * /pages/{id}/pdf/catalog:
     *   get:
     *     summary: Lista filhas acessíveis e propriedades para configurar/exportar templates PDF
     *     tags: [Pages]
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       200: { description: Filhas e metadados de colunas, sem valores de células }
     *       403: { description: Página sem permissão de leitura }
     * /pages/{id}/pdf:
     *   post:
     *     summary: Gera PDF em memória ou lote ZIP usando a página como template das filhas
     *     tags: [Pages]
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema: { type: string }
     *     requestBody:
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               includePageTitle: { type: boolean, default: true }
     *               childIds: { type: array, minItems: 1, maxItems: 50, items: { type: string } }
     *     responses:
     *       200:
     *         description: PDF para uma página ou ZIP para várias, sem persistência
     *         content:
     *           application/pdf: { schema: { type: string, format: binary } }
     *           application/zip: { schema: { type: string, format: binary } }
     *       400: { description: Seleção inválida }
     *       403: { description: Origem ou filha sem permissão de leitura }
     *       413: { description: Exportação excede o limite }
     *       429: { description: Limite de exportações simultâneas }
     */
    this.router.get('/:id/pdf/catalog', middleware.handle, requireScopedPermission('page', 'read', 'view'), this.catalog.bind(this));
    this.router.post('/:id/pdf', middleware.handle, requireScopedPermission('page', 'read', 'view'), this.download.bind(this));
  }
  private fail(response: Response, error: unknown) {
    if (response.destroyed) return;
    if (!response.headersSent) return response.status(error instanceof PagePdfError ? error.status : 500).json({ message: error instanceof PagePdfError ? error.message : 'Não foi possível gerar o PDF' });
  }
  private async catalog(request: Request, response: Response) {
    try { return response.json(await this.service.catalog(routeParam(request, 'id'), request.userId!)); }
    catch (error) { return this.fail(response, error); }
  }
  /** Authenticated, no-store binary export; no generated document is persisted. */
  private async download(request: Request, response: Response) {
    const body: unknown = request.body ?? {};
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => !['childIds', 'includePageTitle'].includes(key))) return response.status(400).json({ message: 'Exportação inválida' });
    const includePageTitle = (body as { includePageTitle?: unknown }).includePageTitle;
    if (includePageTitle !== undefined && typeof includePageTitle !== 'boolean') return response.status(400).json({ message: 'Opção de título inválida' });
    const options = { includePageTitle: includePageTitle !== false };
    const childIds = (body as { childIds?: unknown }).childIds;
    if (childIds !== undefined && (!Array.isArray(childIds) || childIds.some((id) => !isUlid(id)))) return response.status(400).json({ message: 'Filhas inválidas' });
    const abort = new AbortController();
    const close = () => { if (!response.writableFinished) abort.abort(); };
    response.once('close', close);
    let buffer: Buffer | undefined;
    try {
      const pageId = routeParam(request, 'id');
      const result = childIds ? await this.service.batch(pageId, request.userId!, childIds as string[], abort.signal, options) : await this.service.generate(pageId, request.userId!, undefined, abort.signal, options);
      buffer = result.buffer;
      const release = () => { buffer?.fill(0); buffer = undefined; };
      response.once('finish', release); response.once('close', release);
      if (abort.signal.aborted) { release(); return; }
      return response.set({ 'Content-Type': result.contentType, 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="${result.filename}"`, 'Access-Control-Expose-Headers': 'Content-Disposition', 'X-Content-Type-Options': 'nosniff' }).send(result.buffer);
    } catch (error) { buffer?.fill(0); return this.fail(response, error); }
    finally { response.removeListener('close', close); }
  }
}
