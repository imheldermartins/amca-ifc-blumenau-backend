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
 *       required: [id, name, icon, role, pageRootId]
 *       properties:
 *         id: { type: string }
 *         name: { type: string }
 *         icon: { type: string, example: "lucide:boxes" }
 *         role: { type: string, enum: [superadmin, member] }
 *         pageRootId: { type: string }
 *         organizationId: { type: string, nullable: true }
 *         organizationName: { type: string, nullable: true }
 * /workspaces:
 *   get:
 *     summary: Lista somente as workspaces do usuário autenticado
 *     tags: [Workspaces]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Workspaces e memberships do usuário }
 *   post:
 *     summary: Cria workspace consumindo uma chave create single-use
 *     description: A primeira pode ser individual; as adicionais exigem organizationId e superadmin da organização.
 *     tags: [Workspaces]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Workspace, root e membership superadmin criadas }
 *       400: { description: Nome ou chave inválidos }
 *       409: { description: Chave já usada ou expirada }
 * /workspaces/join:
 *   post:
 *     summary: Entra em uma workspace e cria a page-root própria do member
 *     tags: [Workspaces]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Membership member e page-root própria criadas }
 * /workspaces/{id}/members:
 *   get:
 *     summary: Lista membros (somente superadmin)
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

router.post("/access-keys/validate", async (req: Request, res: Response) => {
  const { key, purpose } = (req.body ?? {}) as Input.ValidateWorkspaceKey;
  if (purpose !== undefined && purpose !== "create" && purpose !== "join") {
    return res.status(StatusCode.BAD_REQUEST).json({ message: "Finalidade inválida" });
  }
  const validation = await workspacesController.validateAccessKey(key, req.userId!, purpose);
  return res.status(StatusCode.OK).json(validation);
});

router.post("/join", async (req: Request, res: Response) => {
  const { key } = (req.body ?? {}) as Input.JoinWorkspace;
  const result = await workspacesController.joinWithKey(req.userId!, key);
  return sendMutation(res, result, StatusCode.CREATED);
});

router.post("/", async (req: Request, res: Response) => {
  const { name, key, organizationId } = (req.body ?? {}) as Input.CreateWorkspace;
  const result = await workspacesController.createWithKey(
    req.userId!,
    { name, key, organizationId },
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
  requireWorkspaceAbility("manage", "WorkspaceMembers"),
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
    const { role } = (req.body ?? {}) as Input.UpdateWorkspaceMemberRole;
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
