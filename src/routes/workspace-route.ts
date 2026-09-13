import { Router, type Request, type Response } from "express";
import workspacesController, {
  type WorkspaceMutationResult,
} from "@/controllers/workspaces-controller";
import type { Schema } from "@/models/schemas/index";
import type { Input } from "@/models/schemas/inputs";
import middleware from "@/core/auth/middleware";
import { requireWorkspaceAbility } from "@/core/auth/workspace-access-middleware";
import { StatusCode } from "@core/http/status-code";

const router = Router();

/**
 * @openapi
 * components:
 *   schemas:
 *     WorkspaceSummary:
 *       type: object
 *       required: [id, name, icon, role, pageRootId, isPersonal]
 *       properties:
 *         id: { type: string }
 *         name: { type: string }
 *         icon: { type: string, example: "lucide:boxes" }
 *         role: { type: string, nullable: true }
 *         pageRootId: { type: string }
 *         organizationId: { type: string, nullable: true }
 *         organizationName: { type: string, nullable: true }
 *         isPersonal:
 *           type: boolean
 *           description: true quando a workspace é a área pessoal e não pertence a uma organização
 * /workspaces:
 *   get:
 *     summary: Lista somente as workspaces do usuário autenticado
 *     tags: [Workspaces]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Workspaces e memberships do usuário }
 *   post:
 *     summary: Cria workspace dentro de uma organização
 *     description: Exige organizationId e permissão create na organização. A workspace pessoal nasce no cadastro da conta.
 *     tags: [Workspaces]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Workspace, root e membership do owner criadas }
 *       400: { description: Nome ou organização inválidos }
 *       403: { description: Sem permissão para criar na organização }
 * /workspaces/{id}/members:
 *   get:
 *     summary: Lista membros (permissão de leitura de membros)
 *     tags: [Workspaces]
 *     responses:
 *       200: { description: Membros da workspace }
 *       403: { description: Acesso não permitido }
 */

router.use(middleware.handle);

function sendMutation<T>(
  res: Response,
  result: WorkspaceMutationResult<T>,
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
  const workspaces = await workspacesController.listForUser(req.userId!);
  if (!workspaces) {
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Erro no servidor" });
  }
  return res.status(StatusCode.OK).json(workspaces);
});

router.post("/", async (req: Request, res: Response) => {
  const { name, organizationId } = (req.body ?? {}) as Input.CreateWorkspace;
  const result = await workspacesController.createInOrganization(
    req.userId!,
    { name, organizationId },
  );
  return sendMutation(res, result, StatusCode.CREATED);
});

router.get(
  "/:id/page_root",
  requireWorkspaceAbility("read", "WorkspaceRoot"),
  async (req: Request, res: Response) => {
    const root = await workspacesController.getPageRoot(req.params.id as string, req.userId!);
    if (!root) {
      return res.status(StatusCode.NOT_FOUND).json({ message: '"Workspace" não encontrado' });
    }
    return res.status(StatusCode.OK).json(root);
  },
);

router.get(
  "/:id/members",
  requireWorkspaceAbility("read", "WorkspaceMembers"),
  async (req: Request, res: Response) => {
    const members = await workspacesController.listMembers(req.params.id as string);
    if (!members) {
      return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Erro no servidor" });
    }
    return res.status(StatusCode.OK).json(members);
  },
);

router.put(
  "/:id/members/:userId/role",
  requireWorkspaceAbility("manage", "WorkspaceMembers"),
  async (req: Request, res: Response) => {
    const role = req.body?.roleId ?? req.body?.role;
    const result = await workspacesController.updateMemberRole(
      req.params.id as string,
      req.userId!,
      req.params.userId as string,
      role,
    );
    return sendMutation(res, result, StatusCode.OK);
  },
);

router.get(
  "/:id",
  requireWorkspaceAbility("read", "Workspace"),
  async (req: Request, res: Response) => {
    const workspace = await workspacesController.getForUser(req.params.id as string, req.userId!);
    if (!workspace) {
      return res.status(StatusCode.NOT_FOUND).json({ message: '"Workspace" não encontrado' });
    }
    return res.status(StatusCode.OK).json(workspace);
  },
);

router.put(
  "/:id",
  requireWorkspaceAbility("manage", "WorkspaceSettings"),
  async (req: Request, res: Response) => {
    const { name, icon } = (req.body ?? {}) as Input.UpdateWorkspace;
    const result = await workspacesController.updateSettings(
      req.params.id as string,
      req.userId!,
      { name, icon },
    );
    return sendMutation(res, result, StatusCode.OK);
  },
);

export default router;
