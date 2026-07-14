import type { Request, Response } from "express";
import pageController from "@/controllers/page-controller";
import pageColumnController from "@/controllers/page-column-controller";
import pageColumnValueController from "@/controllers/page-column-value-controller";
import type { Schema } from "@/models/schemas/index";
import type { Input } from "@/models/schemas/inputs";
import { BaseRouter } from "@routes/base-router";
import middleware from "@/core/auth/middleware";
import { StatusCode } from "@core/http/status-code";

const reasonToStatus = (reason: ServiceFailureReason): StatusCode => {
  switch (reason) {
    case "not_found":
      return StatusCode.NOT_FOUND;
    case "validation":
      return StatusCode.BAD_REQUEST;
    case "conflict":
      return StatusCode.CONFLICT;
    default:
      return StatusCode.INTERNAL_SERVER_ERROR;
  }
};

// `?type` das rotas de coluna: nome canônico do schema, aceitando o apelido "number".
const resolveTypeQuery = (req: Request): Schema.ColumnType | undefined => {
  const raw = req.query.type;
  const value = typeof raw === "string" ? raw : undefined;
  return value === "number" ? "numeric" : (value as Schema.ColumnType | undefined);
};

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
 *     summary: Lê o dataset da página parent (linhas + colunas + valores)
 *     tags: [Pages]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: id da página parent (na raiz, == id da workspace)
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Dataset agrupado por página-filha
 *   post:
 *     summary: Adiciona uma página-filha à página parent
 *     tags: [Pages]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: id da página parent
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
 *         description: Página-filha criada e vinculada via page_edges
 *
 * /pages/{id}/breadcrumb:
 *   get:
 *     summary: Trilha de ancestrais (breadcrumb) da página, do topo até ela
 *     description: >
 *       Sobe a hierarquia de page_edges a partir da página-alvo via CTE
 *       recursivo. Retorna, do ancestral mais alto (maior depth) até a própria
 *       página (depth 0), os campos id (child_id), parent_id, slug e depth.
 *     tags: [Pages]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: id da página-alvo (child_id)
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Lista ordenada de ancestrais (breadcrumb)
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                   parent_id:
 *                     type: string
 *                   slug:
 *                     type: string
 *                     nullable: true
 *                   depth:
 *                     type: integer
 *       401:
 *         description: Token de acesso ausente ou inválido
 */

/**
 * @openapi
 * components:
 *   schemas:
 *     SelectOption:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           readOnly: true
 *           description: ULID gerado no backend
 *         value:
 *           type: string
 *         color:
 *           type: string
 *           enum: [red, orange, yellow, green, blue, grey]
 *       required: [value]
 *     PageColumn:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           readOnly: true
 *         name:
 *           type: string
 *           nullable: true
 *         type:
 *           type: string
 *           enum: [text, numeric, select, date, checkbox]
 *           readOnly: true
 *           description: Definido pela query ?type na criação
 *         data:
 *           type: object
 *           description: Config por tipo (options no select, format no numeric)
 *           properties:
 *             options:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/SelectOption'
 *             format:
 *               type: string
 *               enum: [percentage, currency]
 *         parent_id:
 *           type: string
 *           readOnly: true
 *     PageColumnValue:
 *       type: object
 *       description: Resposta decodificada (sem envelope); no banco `data` guarda `{"value":<T>}`.
 *       properties:
 *         id:
 *           type: string
 *           readOnly: true
 *         page_id:
 *           type: string
 *         page_column_id:
 *           type: string
 *         type:
 *           type: string
 *           enum: [text, numeric, select, date, checkbox]
 *           readOnly: true
 *         value:
 *           description: Valor "nu" cujo tipo depende do type da coluna
 *
 * /pages/parent/{id}/columns:
 *   get:
 *     summary: Lista as colunas da página parent
 *     tags: [Pages]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: id da página parent
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Lista de colunas
 *       401:
 *         description: Token de acesso ausente ou inválido
 *   post:
 *     summary: Cria uma coluna na página parent (type vem da query; parent_id da URL)
 *     tags: [Pages]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: type
 *         required: true
 *         description: Tipo da coluna ("number" é aceito como apelido de numeric)
 *         schema:
 *           type: string
 *           enum: [text, numeric, select, date, checkbox]
 *     requestBody:
 *       description: Body dinâmico por tipo (select -> options; numeric -> format)
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 nullable: true
 *               options:
 *                 type: array
 *                 description: Apenas type=select; id de cada option é gerado no backend
 *                 items:
 *                   type: object
 *                   properties:
 *                     value:
 *                       type: string
 *                     color:
 *                       type: string
 *                       enum: [red, orange, yellow, green, blue, grey]
 *                   required: [value]
 *               format:
 *                 type: string
 *                 description: Apenas type=numeric
 *                 enum: [percentage, currency]
 *     responses:
 *       201:
 *         description: Coluna criada
 *       400:
 *         description: Tipo de coluna não suportado ou options/format inválidos
 *       401:
 *         description: Token de acesso ausente ou inválido
 *
 * /pages/parent/{id}/columns/{column_id}:
 *   get:
 *     summary: Busca uma coluna da página parent
 *     tags: [Pages]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: column_id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Coluna encontrada
 *       404:
 *         description: Coluna não encontrada
 *   put:
 *     summary: Atualiza uma coluna da página parent (type opcional via query)
 *     tags: [Pages]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: column_id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: type
 *         required: false
 *         description: Troca o tipo da coluna ("number" = numeric)
 *         schema:
 *           type: string
 *           enum: [text, numeric, select, date, checkbox]
 *     requestBody:
 *       description: Body dinâmico por tipo (select -> options; numeric -> format)
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 nullable: true
 *               options:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     value:
 *                       type: string
 *                     color:
 *                       type: string
 *                       enum: [red, orange, yellow, green, blue, grey]
 *                   required: [value]
 *               format:
 *                 type: string
 *                 enum: [percentage, currency]
 *     responses:
 *       200:
 *         description: Coluna atualizada
 *       400:
 *         description: Tipo de coluna não suportado ou options/format inválidos
 *       404:
 *         description: Coluna não encontrada
 *   delete:
 *     summary: Remove uma coluna da página parent
 *     tags: [Pages]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: column_id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Coluna removida
 *       404:
 *         description: Coluna não encontrada
 *
 * /pages/{id}/column/{column_id}/value:
 *   get:
 *     summary: Lê o valor da célula (página, coluna), decodificado
 *     description: A célula (page_id, page_column_id) tem no máximo UM valor (UNIQUE no banco).
 *     tags: [Pages]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: page_id da linha
 *         schema:
 *           type: string
 *       - in: path
 *         name: column_id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Valor encontrado (decodificado)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PageColumnValue'
 *       401:
 *         description: Token de acesso ausente ou inválido
 *       404:
 *         description: Célula vazia (sem valor definido)
 *   post:
 *     summary: Cria o valor da célula (payload dinâmico; 409 se a célula já tiver valor)
 *     tags: [Pages]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: column_id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       description: "date aceita { startDate, endDate } (vira start@end); demais usam value"
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               value:
 *                 description: Valor "nu"; validado conforme o type da coluna
 *               startDate:
 *                 type: string
 *                 description: Apenas type=date (ISO)
 *               endDate:
 *                 type: string
 *                 description: Apenas type=date (ISO); com startDate forma o range
 *     responses:
 *       201:
 *         description: Valor criado (decodificado)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PageColumnValue'
 *       400:
 *         description: Valor inválido para o tipo da coluna
 *       404:
 *         description: Coluna (column_id) não encontrada
 *       409:
 *         description: Célula já tem valor -- use PUT para atualizar
 *   put:
 *     summary: Atualiza o valor da célula (revalida pelo type da coluna)
 *     tags: [Pages]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: column_id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       description: "date aceita { startDate, endDate }; demais usam value"
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               value:
 *                 description: Novo valor "nu"
 *               startDate:
 *                 type: string
 *                 description: Apenas type=date (ISO)
 *               endDate:
 *                 type: string
 *                 description: Apenas type=date (ISO)
 *     responses:
 *       200:
 *         description: Valor atualizado (decodificado)
 *       400:
 *         description: Valor inválido para o tipo da coluna
 *       404:
 *         description: Célula vazia (ou coluna não encontrada)
 *   delete:
 *     summary: Remove o valor da célula
 *     tags: [Pages]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: column_id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Valor removido
 *       404:
 *         description: Célula vazia (nada a remover)
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
    this.router.get("/:id/breadcrumb", middleware.handle, this.getBreadcrumb.bind(this));

    // Colunas da página parent (:id = id da parent). page_columns não tem rota própria.
    this.router.post("/parent/:id/columns", middleware.handle, this.createColumn.bind(this));
    this.router.get("/parent/:id/columns", middleware.handle, this.listColumns.bind(this));
    this.router.get("/parent/:id/columns/:column_id", middleware.handle, this.getColumn.bind(this));
    this.router.put("/parent/:id/columns/:column_id", middleware.handle, this.updateColumn.bind(this));
    this.router.delete("/parent/:id/columns/:column_id", middleware.handle, this.deleteColumn.bind(this));

    // Valor (célula) de uma coluna numa página (:id = page_id da linha, :column_id = coluna).
    // Singular: a célula (página, coluna) tem no máximo UM valor (UNIQUE no banco).
    this.router.post("/:id/column/:column_id/value", middleware.handle, this.createValue.bind(this));
    this.router.get("/:id/column/:column_id/value", middleware.handle, this.getValue.bind(this));
    this.router.put("/:id/column/:column_id/value", middleware.handle, this.updateValue.bind(this));
    this.router.delete("/:id/column/:column_id/value", middleware.handle, this.deleteValue.bind(this));
  }

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
  
  private async createChild(req: Request, res: Response): Promise<Response> {
    const body = (req.body ?? {}) as Input.CreateChildPage;
    const child = await pageController.createChild(req.params.id as string, req.userId!, body);

    if (!child) {
      return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Erro no servidor" });
    }

    return res.status(StatusCode.CREATED).json(child);
  }

  private async getDataset(req: Request, res: Response): Promise<Response> {
    const dataset = await pageController.getDataset(req.params.id as string);

    if (!dataset) {
      return res.status(StatusCode.NOT_FOUND).json({ message: `"${this.resourceName}" não encontrado` });
    }

    return res.status(StatusCode.OK).json(dataset);
  }

  // GET /pages/:id/breadcrumb -- trilha de ancestrais (CTE recursivo no controller).
  private async getBreadcrumb(req: Request, res: Response): Promise<Response> {
    const crumbs = await pageController.getBreadcrumb(req.params.id as string);

    if (!crumbs) {
      return res.status(StatusCode.NOT_FOUND).json({ message: `"${this.resourceName}" não encontrado` });
    }

    return res.status(StatusCode.OK).json(crumbs);
  }

  // --- Colunas da página parent (page_columns; :id = id da página parent) ---

  // POST /pages/parent/:id/columns?type=<type> -- type vem da query; parent_id da URL.
  private async createColumn(req: Request, res: Response): Promise<Response> {
    const body = (req.body ?? {}) as Input.CreatePageColumn;
    const type = resolveTypeQuery(req) ?? body.type;

    const result = await pageColumnController.createColumn({
      ...(body.name !== undefined && { name: body.name }),
      ...(body.options !== undefined && { options: body.options }),
      ...(body.format !== undefined && { format: body.format }),
      ...(type !== undefined && { type }),
      parent_id: req.params.id as Schema.PageColumn["parent_id"],
    });

    if (!result.ok) {
      return res.status(reasonToStatus(result.reason)).json({ message: result.message });
    }

    return res.status(StatusCode.CREATED).json(result.data);
  }

  // GET /pages/parent/:id/columns
  private async listColumns(req: Request, res: Response): Promise<Response> {
    const columns = await pageColumnController.all(
      { parent_id: req.params.id } as LookupsConfig<Schema.PageColumn>,
    );

    return res.status(StatusCode.OK).json(columns ?? []);
  }

  // GET /pages/parent/:id/columns/:column_id
  private async getColumn(req: Request, res: Response): Promise<Response> {
    const column = await pageColumnController.get(
      { id: req.params.column_id, parent_id: req.params.id } as LookupValues<Schema.PageColumn>,
    );

    if (!column) {
      return res.status(StatusCode.NOT_FOUND).json({ message: `"Page_column" não encontrado` });
    }

    return res.status(StatusCode.OK).json(column);
  }

  // PUT /pages/parent/:id/columns/:column_id?type=<type> -- parent_id imutável.
  private async updateColumn(req: Request, res: Response): Promise<Response> {
    const body = (req.body ?? {}) as Input.UpdatePageColumn;
    const type = resolveTypeQuery(req) ?? body.type;

    const input: Input.UpdatePageColumn = {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.options !== undefined && { options: body.options }),
      ...(body.format !== undefined && { format: body.format }),
      ...(type !== undefined && { type }),
    };

    const result = await pageColumnController.updateColumn(
      { id: req.params.column_id, parent_id: req.params.id } as LookupValues<Schema.PageColumn>,
      input,
    );

    if (!result.ok) {
      return res.status(reasonToStatus(result.reason)).json({ message: result.message });
    }

    return res.status(StatusCode.OK).json(result.data);
  }

  // DELETE /pages/parent/:id/columns/:column_id
  private async deleteColumn(req: Request, res: Response): Promise<Response> {
    const deleted = await pageColumnController.delete(
      { id: req.params.column_id, parent_id: req.params.id } as LookupValues<Schema.PageColumn>,
    );

    if (!deleted) {
      return res.status(StatusCode.NOT_FOUND).json({ message: `"Page_column" não encontrado` });
    }

    return res.status(StatusCode.NO_CONTENT).send();
  }

  // --- Valor de célula (page_columns_values; :id = page_id da linha, :column_id = coluna) ---

  // POST /pages/:id/column/:column_id/value -- cria o valor da célula (409 se já existir).
  private async createValue(req: Request, res: Response): Promise<Response> {
    const body = (req.body ?? {}) as Input.CreatePageColumnValue;

    const result = await pageColumnValueController.createValue({
      page_id: req.params.id,
      page_column_id: req.params.column_id,
      ...(body.value !== undefined && { value: body.value }),
      ...(body.startDate !== undefined && { startDate: body.startDate }),
      ...(body.endDate !== undefined && { endDate: body.endDate }),
    } as Input.CreatePageColumnValue);

    if (!result.ok) {
      return res.status(reasonToStatus(result.reason)).json({ message: result.message });
    }

    return res.status(StatusCode.CREATED).json(result.data);
  }

  // GET /pages/:id/column/:column_id/value -- lê o valor da célula (404 se vazia).
  private async getValue(req: Request, res: Response): Promise<Response> {
    const result = await pageColumnValueController.getValue(
      req.params.id as string,
      req.params.column_id as string,
    );

    if (!result.ok) {
      return res.status(reasonToStatus(result.reason)).json({ message: result.message });
    }

    return res.status(StatusCode.OK).json(result.data);
  }

  // PUT /pages/:id/column/:column_id/value -- atualiza a célula; revalida pelo type.
  private async updateValue(req: Request, res: Response): Promise<Response> {
    const body = (req.body ?? {}) as Input.UpdatePageColumnValue;

    const result = await pageColumnValueController.updateValue(
      req.params.id as string,
      req.params.column_id as string,
      {
        ...(body.value !== undefined && { value: body.value }),
        ...(body.startDate !== undefined && { startDate: body.startDate }),
        ...(body.endDate !== undefined && { endDate: body.endDate }),
      },
    );

    if (!result.ok) {
      return res.status(reasonToStatus(result.reason)).json({ message: result.message });
    }

    return res.status(StatusCode.OK).json(result.data);
  }

  // DELETE /pages/:id/column/:column_id/value -- remove o valor da célula (404 se vazia).
  private async deleteValue(req: Request, res: Response): Promise<Response> {
    const result = await pageColumnValueController.deleteValue(
      req.params.id as string,
      req.params.column_id as string,
    );

    if (!result.ok) {
      return res.status(reasonToStatus(result.reason)).json({ message: result.message });
    }

    return res.status(StatusCode.NO_CONTENT).send();
  }
}

export default new PageRouter().router;
