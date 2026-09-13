import { Router, type Request, type Response } from 'express';
import middleware from '@core/auth/middleware';
import { ACCESS_SCOPES, PERMISSION_CATALOG, type AccessScope } from '@core/auth/permissions';
import { ULID_RE } from '@db/scoped-access-store';
import controller, { type AccessResult } from '@controllers/access-controller';
import { StatusCode } from '@core/http/status-code';
const router = Router();
router.use(middleware.handle);
router.get('/catalog', (_req, res) => res.json(PERMISSION_CATALOG));
router.use('/:scope/:id', (req, res, next) => {
  if (!ACCESS_SCOPES.includes(req.params.scope as AccessScope) || !ULID_RE.test(req.params.id as string)) {
    res.status(StatusCode.BAD_REQUEST).json({ message: 'Escopo inválido' }); return;
  }
  next();
});
const args = (req: Request): [AccessScope, string, string] => [req.params.scope as AccessScope, req.params.id as string, req.userId!];
const send = (res: Response, result: AccessResult, status: number = StatusCode.OK) => result.ok ? res.status(status).json(result.data)
  : res.status({ validation: StatusCode.BAD_REQUEST, forbidden: StatusCode.FORBIDDEN, conflict: StatusCode.CONFLICT, server_error: StatusCode.INTERNAL_SERVER_ERROR }[result.reason]).json({ message: result.message });
/**
 * @openapi
 * /access/{scope}/{id}:
 *   get:
 *     summary: Permissões efetivas do usuário autenticado no escopo
 *     tags: [Access]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: scope, required: true, schema: { type: string, enum: [organization, workspace, page] } }
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Propriedade, membership, role e permissões }
 *       403: { description: Sem leitura }
 */
router.get('/:scope/:id', async (req, res) => send(res, await controller.current(...args(req))));
router.get('/:scope/:id/roles', async (req, res) => send(res, await controller.roles(...args(req))));
router.post('/:scope/:id/roles', async (req, res) => send(res, await controller.saveRole(...args(req), req.body ?? {})));
router.put('/:scope/:id/roles/:roleId', async (req, res) => send(res, await controller.saveRole(...args(req), req.body ?? {}, req.params.roleId as string)));
router.delete('/:scope/:id/roles/:roleId', async (req, res) => send(res, await controller.removeRole(...args(req), req.params.roleId as string)));
router.get('/:scope/:id/organization-workspace-roles', async (req, res) => send(res, await controller.organizationWorkspaceRoles(...args(req))));
router.post('/:scope/:id/roles/:roleId/copy', async (req, res) => send(res, await controller.copyWorkspaceRole(...args(req), req.params.roleId as string)));
router.get('/:scope/:id/members', async (req, res) => send(res, await controller.members(...args(req))));
router.get('/:scope/:id/member/:memberId', async (req, res) => send(res, await controller.members(...args(req), req.params.memberId as string)));
router.post('/:scope/:id/members', async (req, res) => send(res, await controller.addMember(...args(req), req.body ?? {})));
router.put('/:scope/:id/member/:userId', async (req, res) => send(res, await controller.assign(...args(req), req.params.userId as string, req.body?.roleId)));
router.delete('/:scope/:id/member/:userId', async (req, res) => send(res, await controller.removeMember(...args(req), req.params.userId as string)));
router.get('/:scope/:id/member-search', async (req, res) => send(res, await controller.searchEmail(...args(req), req.query.email)));
router.get('/:scope/:id/invites', async (req, res) => send(res, await controller.invites(...args(req))));
router.post('/:scope/:id/invites', async (req, res) => send(res, await controller.createInvite(...args(req), req.body ?? {}), StatusCode.CREATED));
router.delete('/:scope/:id/invites/:inviteId', async (req, res) => send(res, await controller.removeInvite(...args(req), req.params.inviteId as string)));
router.get('/:scope/:id/requests', async (req, res) => send(res, await controller.requests(...args(req))));
router.post('/:scope/:id/requests', async (req, res) => send(res, await controller.request(...args(req))));
router.post('/:scope/:id/requests/:requestId/decision', async (req, res) => send(res, await controller.decide(...args(req), req.params.requestId as string, req.body ?? {})));
export default router;
