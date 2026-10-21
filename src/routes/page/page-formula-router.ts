import type {Request,Response} from 'express';
import {ApplicationRouter} from '@/routes/application-router';
import middleware from '@/services/auth/middleware';
import {requirePageAccess} from '@/services/auth/page-access-middleware';
import {authenticatedUserId,routeParam} from '@/routes/request-values';
import {sendPageFailure} from '@/routes/page/page-route-responder';
import controller from '@/controllers/page-formula-controller';

export class PageFormulaRouter extends ApplicationRouter {
  /**
   * @openapi
   * /api/v1/pages/parent/{id}/formula/catalog:
   *   get:
   *     summary: Catálogo autorizado de propriedades para fórmulas
   *     tags: [Pages]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - { in: path, name: id, required: true, schema: { type: string } }
   *     responses:
   *       '200': { description: Propriedades da base e dos destinos legíveis }
   *       '403': { description: Acesso negado }
   * /api/v1/pages/parent/{id}/formula/preview:
   *   post:
   *     summary: Valida uma fórmula e opcionalmente calcula sobre uma página
   *     tags: [Pages]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - { in: path, name: id, required: true, schema: { type: string } }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [source]
   *             properties:
   *               source: { type: string, maxLength: 8192 }
   *               columnId: { type: string }
   *               pageId: { type: string }
   *     responses:
   *       '200': { description: Resultado tipado ou diagnósticos de validação }
   *       '400': { description: Entrada inválida }
   *       '403': { description: Acesso negado }
   */
  protected registerRoutes():void {
    this.router.get('/parent/:id/formula/catalog',middleware.handle,requirePageAccess(),this.catalog.bind(this));
    this.router.post('/parent/:id/formula/preview',middleware.handle,requirePageAccess(),this.preview.bind(this));
  }
  private async catalog(req:Request,res:Response):Promise<Response>{
    const result=await controller.catalog(routeParam(req,'id'),authenticatedUserId(req));
    return result.ok?res.json(result.data):sendPageFailure(res,result);
  }
  private async preview(req:Request,res:Response):Promise<Response>{
    const result=await controller.preview(routeParam(req,'id'),authenticatedUserId(req),req.body??{});
    return result.ok?res.json(result.data):sendPageFailure(res,result);
  }
}
