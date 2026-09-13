import { Router, type Response } from 'express';
import controller, { type OrganizationMutationResult } from '@controllers/organizations-controller';
import middleware from '@core/auth/middleware';
import { requireScopedPermission } from '@core/auth/scoped-access-middleware';
import { StatusCode } from '@core/http/status-code';
const router = Router();
router.use(middleware.handle);
function send<T>(res: Response, result: OrganizationMutationResult<T>, status: number) {
  return result.ok ? res.status(status).json(result.data) : res.status({validation:StatusCode.BAD_REQUEST,forbidden:StatusCode.FORBIDDEN,conflict:StatusCode.CONFLICT,not_found:StatusCode.NOT_FOUND,server_error:StatusCode.INTERNAL_SERVER_ERROR}[result.reason]).json({ message: result.message });
}
/**
 * @openapi
 * /organizations:
 *   get:
 *     summary: Organizações acessíveis por propriedade ou role
 *     tags: [Organizations]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Organizações com permissões efetivas }
 *   post:
 *     summary: Cria organização para a conta autenticada e validada
 *     tags: [Organizations]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string, maxLength: 120 }
 *     responses:
 *       201: { description: Organização criada }
 *       409: { description: Conta não validada ou operação indisponível }
 */
router.get('/', async (req, res) => {
  const list = await controller.listForUser(req.userId!);
  return list ? res.json(list) : res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: 'Erro no servidor' });
});
router.post('/', async (req, res) => send(res, await controller.create(req.userId!, req.body ?? {}), StatusCode.CREATED));
router.get('/:id/workspaces', requireScopedPermission('organization', 'read', 'workspaces'), async (req, res) => {
  const list = await controller.catalog(req.params.id as string, req.userId!);
  return list ? res.json(list) : res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: 'Erro no servidor' });
});
router.put('/:id/workspaces/:workspaceId', async (req, res) => send(res, await controller.linkWorkspace(req.params.id as string, req.params.workspaceId as string, req.userId!), StatusCode.OK));
router.get('/:id', requireScopedPermission('organization', 'read', 'view'), async (req, res) => {
  const organization = await controller.getForUser(req.params.id as string, req.userId!);
  return organization ? res.json(organization) : res.status(StatusCode.NOT_FOUND).json({ message: 'Organização não encontrada' });
});
router.put('/:id', requireScopedPermission('organization', 'write', 'update'), async (req, res) => send(res, await controller.update(req.params.id as string, req.userId!, req.body ?? {}), StatusCode.OK));
export default router;
