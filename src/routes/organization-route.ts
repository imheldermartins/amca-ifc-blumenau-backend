import { Router, type Request, type Response } from "express";
import organizationsController, {
  type OrganizationMutationResult,
} from "@controllers/organizations-controller";
import type { Input } from "@/models/schemas/inputs";
import middleware from "@/core/auth/middleware";
import { StatusCode } from "@core/http/status-code";

const router = Router();

/**
 * @openapi
 * components:
 *   schemas:
 *     OrganizationSummary:
 *       type: object
 *       required: [id, name, role, workspaceCount]
 *       properties:
 *         id: { type: string }
 *         name: { type: string }
 *         data: { type: object }
 *         role: { type: string, enum: [superadmin, member] }
 *         workspaceCount: { type: integer }
 * /organizations:
 *   get:
 *     summary: Lista as organizações do usuário autenticado
 *     tags: [Organizations]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Organizações e roles do usuário }
 *   post:
 *     summary: Cria uma organização vinculando sua primeira workspace individual
 *     tags: [Organizations]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Organização criada; criador é superadmin }
 *       403: { description: Usuário não é superadmin da workspace }
 *       409: { description: Workspace já está vinculada }
 * /organizations/{id}/workspaces/{workspaceId}:
 *   put:
 *     summary: Vincula uma workspace individual a uma organização
 *     tags: [Organizations]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Workspace vinculada }
 *       403: { description: Exige superadmin da organização e da workspace }
 *       409: { description: Workspace já está vinculada }
 * /organizations/{id}/workspaces/{workspaceId}/users:
 *   get:
 *     summary: Busca usuários para a organização e a workspace
 *     description: Exige superadmin nos dois escopos; ordena correspondências por prefixo antes de ocorrência.
 *     tags: [Organizations]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: q, schema: { type: string } }
 *     responses:
 *       200: { description: Usuários com os vínculos atuais }
 *       403: { description: Acesso não permitido }
 * /organizations/{id}/workspaces/{workspaceId}/users/{userId}:
 *   post:
 *     summary: Adiciona um usuário como member da organização e da workspace
 *     tags: [Organizations]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Usuário e vínculos criados }
 *       403: { description: Exige superadmin da organização e da workspace }
 */

router.use(middleware.handle);

function sendMutation<T>(
  res: Response,
  result: OrganizationMutationResult<T>,
  successStatus: number,
): Response {
  if (result.ok) return res.status(successStatus).json(result.data);

  const status = result.reason === "conflict"
    ? StatusCode.CONFLICT
    : result.reason === "forbidden"
      ? StatusCode.FORBIDDEN
      : result.reason === "not_found"
        ? StatusCode.NOT_FOUND
        : result.reason === "server_error"
          ? StatusCode.INTERNAL_SERVER_ERROR
          : StatusCode.BAD_REQUEST;
  return res.status(status).json({ message: result.message });
}

router.get("/", async (req: Request, res: Response) => {
  const organizations = await organizationsController.listForUser(req.userId!);
  if (!organizations) {
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Erro no servidor" });
  }
  return res.status(StatusCode.OK).json(organizations);
});

router.post("/", async (req: Request, res: Response) => {
  const { name, workspaceId } = (req.body ?? {}) as Input.CreateOrganization;
  const result = await organizationsController.create(req.userId!, { name, workspaceId });
  return sendMutation(res, result, StatusCode.CREATED);
});

router.put("/:id/workspaces/:workspaceId", async (req: Request, res: Response) => {
  const result = await organizationsController.linkWorkspace(
    req.params.id as string,
    req.params.workspaceId as string,
    req.userId!,
  );
  return sendMutation(res, result, StatusCode.OK);
});

router.get("/:id/workspaces/:workspaceId/users", async (req: Request, res: Response) => {
  const result = await organizationsController.searchWorkspaceUsers(
    req.params.id as string,
    req.params.workspaceId as string,
    req.userId!,
    req.query.q,
  );
  return sendMutation(res, result, StatusCode.OK);
});

router.post("/:id/workspaces/:workspaceId/users/:userId", async (req: Request, res: Response) => {
  const result = await organizationsController.addWorkspaceUser(
    req.params.id as string,
    req.params.workspaceId as string,
    req.userId!,
    req.params.userId as string,
  );
  return sendMutation(res, result, StatusCode.CREATED);
});

export default router;
