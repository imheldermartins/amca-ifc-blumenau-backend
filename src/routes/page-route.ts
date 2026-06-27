import type { Request, Response } from "express";
import pageController from "@/controllers/page-controller";
import type { Schema } from "@/models/schemas/index";
import type { Input } from "@/models/schemas/inputs";
import { BaseRouter } from "@routes/base-router";
import middleware from "@/core/auth/middleware";
import { StatusCode } from "@core/http/status-code";

/**
 * @openapi
 * components:
 *   schemas:
 *     Page:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           readOnly: true
 *         title:
 *           type: string
 *           nullable: true
 *         data:
 *           type: object
 *         owner_id:
 *           type: string
 *           readOnly: true
 *
 * /pages:
 *   get:
 *     summary: Lista as páginas do usuário autenticado
 *     tags: [Pages]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de páginas do dono (token)
 *       401:
 *         description: Token de acesso ausente ou inválido
 *   post:
 *     summary: Cria uma página (owner_id vem do token)
 *     tags: [Pages]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *                 nullable: true
 *               data:
 *                 type: object
 *     responses:
 *       201:
 *         description: Página criada
 *       401:
 *         description: Token de acesso ausente ou inválido
 *
 * /pages/{id}:
 *   get:
 *     summary: Busca uma página própria por id
 *     tags: [Pages]
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
 *         description: Página encontrada
 *       401:
 *         description: Token de acesso ausente ou inválido
 *       404:
 *         description: Página não encontrada
 *   put:
 *     summary: Atualiza uma página própria
 *     tags: [Pages]
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
 *         description: Página atualizada
 *       401:
 *         description: Token de acesso ausente ou inválido
 *   delete:
 *     summary: Remove uma página própria
 *     tags: [Pages]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Página removida
 *       401:
 *         description: Token de acesso ausente ou inválido
 *
 * /pages/{id}/page:
 *   get:
 *     summary: Lê o dataset da page_root (linhas + colunas + valores)
 *     tags: [Pages]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: id da page_root (== id da workspace)
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Dataset agrupado por página-filha
 *   post:
 *     summary: Adiciona uma página-filha à page_root
 *     tags: [Pages]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: id da page_root
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *                 nullable: true
 *               data:
 *                 type: object
 *     responses:
 *       201:
 *         description: Página-filha criada e vinculada via page_hubs
 */

/**
 * Pages: CRUD completo protegido por JWT. O `owner_id` SEMPRE vem do token
 * (req.userId), nunca do payload, e as leituras/escritas são escopadas ao dono.
 * As rotas adicionais (motor de páginas) são registradas ao lado do CRUD base,
 * sem alterar o BaseRouter.
 */
class PageRouter extends BaseRouter<Schema.Page> {
  protected readonly resourceName = "Page";

  constructor() {
    super(pageController, {
      all: [middleware.handle],
      get: [middleware.handle],
      create: [middleware.handle],
      update: [middleware.handle],
      delete: [middleware.handle],
    });

    // Rotas adicionais (registradas após o CRUD base do super()):
    this.router.post("/:id/page", middleware.handle, this.createChild.bind(this));
    this.router.get("/:id/page", middleware.handle, this.getDataset.bind(this));
  }

  // --- CRUD base escopado ao dono (owner_id = token) ---

  protected override async all(req: Request, res: Response): Promise<Response> {
    const items = await this.controller.all({ owner_id: req.userId } as LookupsConfig<Schema.Page>);
    return res.status(StatusCode.OK).json(items ?? []);
  }

  protected override async get(req: Request, res: Response): Promise<Response> {
    const item = await this.controller.get(
      { id: req.params.id, owner_id: req.userId } as LookupValues<Schema.Page>,
    );

    if (!item) {
      return res.status(StatusCode.NOT_FOUND).json({ message: `"${this.resourceName}" não encontrado` });
    }

    return res.status(StatusCode.OK).json(item);
  }

  protected override async create(req: Request, res: Response): Promise<Response> {
    // Whitelist: só title/data vêm do cliente; owner_id sai do token.
    const { title, data } = (req.body ?? {}) as Input.CreatePage;

    const payload = {
      ...(title !== undefined && { title }),
      ...(data !== undefined && { data }),
      owner_id: req.userId,
    } as unknown as CreateValues<Schema.Page>;

    const item = await this.controller.create(payload);

    if (!item) {
      return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Erro no servidor" });
    }

    return res.status(StatusCode.CREATED).json(item);
  }

  protected override async update(req: Request, res: Response): Promise<Response> {
    // Whitelist: só title/data são editáveis; owner_id/id ficam fora do body.
    const { title, data } = (req.body ?? {}) as Input.UpdatePage;

    const payload = {
      ...(title !== undefined && { title }),
      ...(data !== undefined && { data }),
    } as UpdateValues<Schema.Page>;

    const item = await this.controller.update(
      { id: req.params.id, owner_id: req.userId } as LookupValues<Schema.Page>,
      payload,
    );

    if (!item) {
      return res.status(StatusCode.NOT_FOUND).json({ message: `"${this.resourceName}" não encontrado ou falha ao atualizar` });
    }

    return res.status(StatusCode.OK).json(item);
  }

  protected override async delete(req: Request, res: Response): Promise<Response> {
    const deleted = await this.controller.delete(
      { id: req.params.id, owner_id: req.userId } as LookupValues<Schema.Page>,
    );

    if (!deleted) {
      return res.status(StatusCode.NOT_FOUND).json({ message: `"${this.resourceName}" não encontrado` });
    }

    return res.status(StatusCode.NO_CONTENT).send();
  }

  // --- Rotas adicionais ---

  // POST /pages/:id/page -- adiciona uma página-filha à page_root :id (page + page_hub).
  private async createChild(req: Request, res: Response): Promise<Response> {
    const body = (req.body ?? {}) as Input.CreateChildPage;
    const child = await pageController.createChild(req.params.id as string, req.userId!, body);

    if (!child) {
      return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Erro no servidor" });
    }

    return res.status(StatusCode.CREATED).json(child);
  }

  // GET /pages/:id/page -- lê o dataset da page_root :id (linhas + colunas + valores) via sqlRaw.
  private async getDataset(req: Request, res: Response): Promise<Response> {
    const dataset = await pageController.getDataset(req.params.id as string);

    if (!dataset) {
      return res.status(StatusCode.NOT_FOUND).json({ message: `"${this.resourceName}" não encontrado` });
    }

    return res.status(StatusCode.OK).json(dataset);
  }
}

export default new PageRouter().router;
