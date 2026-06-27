import type { Request, Response } from "express";
import workspacesController from "@/controllers/workspaces-controller";
import type { Schema } from "@/models/schemas/index";
import type { Input } from "@/models/schemas/inputs";
import { BaseRouter } from "@routes/base-router";
import middleware from "@/core/auth/middleware";
import { StatusCode } from "@core/http/status-code";

/**
 * @openapi
 * components:
 *   schemas:
 *     Workspace:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           readOnly: true
 *         name:
 *           type: string
 *           nullable: true
 *         data:
 *           type: object
 *
 * /workspaces:
 *   get:
 *     summary: Lista workspaces
 *     tags: [Workspaces]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de workspaces
 *   post:
 *     summary: Cria uma workspace (id ULID é gerado pelo servidor)
 *     tags: [Workspaces]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 nullable: true
 *               data:
 *                 type: object
 *     responses:
 *       201:
 *         description: Workspace criada
 *
 * /workspaces/{id}/page_root:
 *   get:
 *     summary: Retorna (ou cria, se ainda não existir) a page_root do usuário autenticado nesta workspace
 *     description: >
 *       GET-or-create. A page_root é a página cujo `id` é igual ao id da workspace
 *       e cujo `owner_id` é o usuário do token. Se ainda não existir, é criada com
 *       um título padrão derivado do primeiro nome do usuário (ou do `title` enviado).
 *     tags: [Workspaces]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: page_root encontrada ou recém-criada
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Page'
 *       401:
 *         description: Token de acesso ausente ou inválido
 *       404:
 *         description: Workspace não encontrada
 */
class WorkspaceRouter extends BaseRouter<Schema.Workspace> {
  protected readonly resourceName = "Workspace";

  constructor() {
    super(workspacesController, {
      all: [middleware.handle],
      get: [middleware.handle],
      create: [middleware.handle],
      update: [middleware.handle],
      delete: [middleware.handle],
    });

    // GET-or-create da page_root do usuário autenticado nesta workspace.
    this.router.get("/:id/page_root", middleware.handle, this.getPageRoot.bind(this));
  }

  // --- CRUD base com whitelist de payload (id ULID é gerado pelo servidor) ---

  protected override async create(req: Request, res: Response): Promise<Response> {
    const { name, data } = (req.body ?? {}) as Input.CreateWorkspace;

    const payload = {
      ...(name !== undefined && { name }),
      ...(data !== undefined && { data }),
    } as unknown as CreateValues<Schema.Workspace>;

    const item = await this.controller.create(payload);

    if (!item) {
      return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Erro no servidor" });
    }

    return res.status(StatusCode.CREATED).json(item);
  }

  protected override async update(req: Request, res: Response): Promise<Response> {
    const { name, data } = (req.body ?? {}) as Input.UpdateWorkspace;

    const payload = {
      ...(name !== undefined && { name }),
      ...(data !== undefined && { data }),
    } as UpdateValues<Schema.Workspace>;

    const item = await this.controller.update(
      { id: req.params.id } as unknown as LookupValues<Schema.Workspace>,
      payload,
    );

    if (!item) {
      return res.status(StatusCode.NOT_FOUND).json({ message: `"${this.resourceName}" não encontrado ou falha ao atualizar` });
    }

    return res.status(StatusCode.OK).json(item);
  }

  // GET /workspaces/:id/page_root
  private async getPageRoot(req: Request, res: Response): Promise<Response> {
    const { title } = (req.body ?? {}) as Input.PageRootQuery;

    const root = await workspacesController.getOrCreatePageRoot(req.params.id as string, req.userId!, title);

    if (!root) {
      return res.status(StatusCode.NOT_FOUND).json({ message: `"${this.resourceName}" não encontrado` });
    }

    return res.status(StatusCode.OK).json(root);
  }
}

export default new WorkspaceRouter().router;
