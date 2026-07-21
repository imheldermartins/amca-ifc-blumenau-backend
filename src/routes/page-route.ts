import type { Request, Response } from "express";
import pageController from "@/controllers/page-controller";
import pageColumnController from "@/controllers/page-column-controller";
import pageColumnValueController from "@/controllers/page-column-value-controller";
import pageCollaboratorController from "@/controllers/page-collaborator-controller";
import type { Schema } from "@/models/schemas/index";
import type { Input } from "@/models/schemas/inputs";
import { BaseRouter } from "@routes/base-router";
import middleware from "@/core/auth/middleware";
import { requirePageAccess } from "@/core/auth/page-access-middleware";
import pageAccessController from "@/controllers/page-access-controller";
import realtimeService from "@core/socket/realtime-service";
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
 *       página (depth 0), os campos id (child_id), parent_id e depth.
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
 * @openapi
 * components:
 *   schemas:
 *     PageCollaborator:
 *       type: object
 *       description: Vínculo (page_collaborators) de um usuário com acesso à página.
 *       properties:
 *         id:
 *           type: string
 *           readOnly: true
 *         page_id:
 *           type: string
 *         user_id:
 *           type: string
 *     PageCollaboratorSummary:
 *       type: object
 *       description: Resumo do usuário-colaborador (sem o vínculo), usado na listagem.
 *       properties:
 *         id:
 *           type: string
 *           description: id do USUÁRIO (não do vínculo)
 *         name:
 *           type: string
 *           nullable: true
 *         email:
 *           type: string
 *
 * /pages/{id}/collaborators:
 *   get:
 *     summary: Lista os colaboradores da página (resumo do usuário)
 *     description: >
 *       Devolve os usuários com acesso à página (join de page_collaborators com
 *       users), apenas com id, name e email -- nunca dados sensíveis. Página
 *       sem colaboradores responde lista vazia.
 *     tags: [Pages]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: id da página
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Lista de colaboradores (pode ser vazia)
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/PageCollaboratorSummary'
 *       401:
 *         description: Token de acesso ausente ou inválido
 *   post:
 *     summary: Adiciona usuários (colaboradores) à página, em lote
 *     description: >
 *       Vincula um ou mais usuários à página via page_collaborators. Idempotente: quem
 *       já colabora entra em `skipped` (sem colidir no UNIQUE). Todos os
 *       `userIds` precisam existir; caso contrário nada é gravado (404).
 *     tags: [Pages]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: id da página
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               userIds:
 *                 type: array
 *                 description: ULIDs dos usuários a vincular
 *                 items:
 *                   type: string
 *             required: [userIds]
 *     responses:
 *       201:
 *         description: Colaboradores processados (criados e/ou já existentes)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 added:
 *                   type: array
 *                   description: Vínculos criados agora
 *                   items:
 *                     $ref: '#/components/schemas/PageCollaborator'
 *                 skipped:
 *                   type: array
 *                   description: user_ids que já eram colaboradores
 *                   items:
 *                     type: string
 *       400:
 *         description: userIds ausente/vazio ou com ULID inválido
 *       401:
 *         description: Token de acesso ausente ou inválido
 *       404:
 *         description: Página ou algum dos usuários não encontrado
 *
 * /pages/{id}/collaborators/{collaboratorId}:
 *   get:
 *     summary: Detalha o vínculo (page_collaborators) de um colaborador na página
 *     description: >
 *       Diferente da listagem: aqui volta a LINHA da tabela page_collaborators
 *       (id do vínculo, page_id, user_id e timestamps), não o resumo do usuário.
 *     tags: [Pages]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: id da página
 *         schema:
 *           type: string
 *       - in: path
 *         name: collaboratorId
 *         required: true
 *         description: user_id do colaborador
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Vínculo encontrado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PageCollaborator'
 *       400:
 *         description: id inválido
 *       401:
 *         description: Token de acesso ausente ou inválido
 *       404:
 *         description: Vínculo (colaborador) não encontrado nesta página
 *   delete:
 *     summary: Remove um colaborador da página
 *     tags: [Pages]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: id da página
 *         schema:
 *           type: string
 *       - in: path
 *         name: collaboratorId
 *         required: true
 *         description: user_id do colaborador a remover
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Colaborador removido
 *       400:
 *         description: id inválido
 *       401:
 *         description: Token de acesso ausente ou inválido
 *       404:
 *         description: Vínculo (colaborador) não encontrado nesta página
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
      get: [middleware.handle, requirePageAccess()],
      create: [middleware.handle],
      update: [middleware.handle, requirePageAccess()],
      // DELETE segue exclusivo do DONO (o handler filtra por `owner_id`):
      // colaborar numa base não é poder apagá-la.
      delete: [middleware.handle],
    });

    // Rotas adicionais (registradas após o CRUD base do super()). O
    // `requirePageAccess` é o guarda de dono-ou-colaborador (herdado pela árvore).
    this.router.post("/:id/page", middleware.handle, requirePageAccess(), this.createChild.bind(this));
    this.router.get("/:id/page", middleware.handle, requirePageAccess(), this.getDataset.bind(this));
    this.router.get("/:id/breadcrumb", middleware.handle, requirePageAccess(), this.getBreadcrumb.bind(this));

    // Colaboradores (page_collaborators): acesso N:N à página. Adição em lote; leitura e
    // remoção unitárias por :collaboratorId (= user_id).
    this.router.get("/:id/collaborators", middleware.handle, this.listCollaborators.bind(this));
    this.router.get("/:id/collaborators/:collaboratorId", middleware.handle, this.getCollaborator.bind(this));
    this.router.post("/:id/collaborators", middleware.handle, this.addCollaborators.bind(this));
    this.router.delete("/:id/collaborators/:collaboratorId", middleware.handle, this.removeCollaborator.bind(this));

    // Colunas da página parent (:id = id da parent). page_columns não tem rota própria.
    this.router.post("/parent/:id/columns", middleware.handle, requirePageAccess(), this.createColumn.bind(this));
    this.router.get("/parent/:id/columns", middleware.handle, requirePageAccess(), this.listColumns.bind(this));
    this.router.get("/parent/:id/columns/:column_id", middleware.handle, requirePageAccess(), this.getColumn.bind(this));
    this.router.put("/parent/:id/columns/:column_id", middleware.handle, requirePageAccess(), this.updateColumn.bind(this));
    this.router.delete("/parent/:id/columns/:column_id", middleware.handle, requirePageAccess(), this.deleteColumn.bind(this));

    // Valor (célula) de uma coluna numa página (:id = page_id da linha, :column_id = coluna).
    // Singular: a célula (página, coluna) tem no máximo UM valor (UNIQUE no banco).
    this.router.post("/:id/column/:column_id/value", middleware.handle, requirePageAccess(), this.createValue.bind(this));
    this.router.get("/:id/column/:column_id/value", middleware.handle, requirePageAccess(), this.getValue.bind(this));
    this.router.put("/:id/column/:column_id/value", middleware.handle, requirePageAccess(), this.updateValue.bind(this));
    this.router.delete("/:id/column/:column_id/value", middleware.handle, requirePageAccess(), this.deleteValue.bind(this));
  }

  /**
   * `GET /pages/shared` é caminho FIXO e precisa vencer o `GET /:id` do CRUD —
   * registrado aqui, e não no construtor, porque o super() já registra o
   * "/:id" antes de o corpo do construtor rodar (era exatamente o bug: a aba
   * "Colaborando" pedia /pages/shared e o express respondia com o handler de
   * página, id="shared", que não passa nem no formato de ULID → 404).
   */
  protected override staticRoutes(): void {
    this.router.get("/shared", middleware.handle, this.listShared.bind(this));
  }

  protected override async all(req: Request, res: Response): Promise<Response> {
    const items = await this.controller.all({ owner_id: req.userId } as LookupsConfig<Schema.Page>);
    return res.status(StatusCode.OK).json(items ?? []);
  }

  /**
   * A busca é por id SEM `owner_id`: quem pode ver já foi decidido pelo
   * `requirePageAccess` (dono OU colaborador, herdado pela árvore). Filtrar por dono
   * aqui era o que impedia o colaborador de abrir a base compartilhada.
   */
  protected override async get(req: Request, res: Response): Promise<Response> {
    const item = await this.controller.get({ id: req.params.id } as LookupValues<Schema.Page>);

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
      { id: req.params.id } as LookupValues<Schema.Page>,
      payload,
    );

    if (!item) {
      return res.status(StatusCode.NOT_FOUND).json({ message: `"${this.resourceName}" não encontrado ou falha ao atualizar` });
    }

    // Emite só DEPOIS do commit — o socket notifica, nunca grava. As duas
    // metades desta rota vão para salas DIFERENTES, porque são coisas
    // diferentes:
    //
    //  - `data` é o SNAPSHOT das views desta página → sala da PRÓPRIA página
    //    (quem está com ela aberta);
    //  - `title` é o rótulo da página enquanto LINHA de outra → sala da
    //    PARENT, que é a tabela onde ela aparece.
    if (data !== undefined) {
      realtimeService.emitViewUpdated({
        pageId: req.params.id as string,
        data,
        updatedAt: new Date().toISOString(),
        originUserId: req.userId as string,
      });
    }

    if (title !== undefined) {
      const rowId = req.params.id as string;
      const parentId = await pageAccessController.getParentId(rowId);
      if (parentId) {
        realtimeService.emitRowUpdated({
          pageId: parentId,
          rowId,
          title: title ?? null,
          updatedAt: new Date().toISOString(),
          originUserId: req.userId as string,
        });
      }
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

    // A sala é a PARENT (a tabela aberta), e a linha nova é a filha.
    realtimeService.emitRowCreated({
      pageId: req.params.id as string,
      rowId: child.id,
      updatedAt: new Date().toISOString(),
      originUserId: req.userId as string,
    });

    return res.status(StatusCode.CREATED).json(child);
  }

  /** GET /pages/shared -- páginas onde sou MEMBRO (aba "Colaborando"). */
  private async listShared(req: Request, res: Response): Promise<Response> {
    const pages = await pageAccessController.listSharedPages(req.userId as string);
    return res.status(StatusCode.OK).json(pages ?? []);
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

  // --- Colaboradores da página (page_collaborators; :id = page_id, :collaboratorId = user_id) ---

  // GET /pages/:id/collaborators -- lista os colaboradores como resumo do usuário.
  private async listCollaborators(req: Request, res: Response): Promise<Response> {
    const members = await pageCollaboratorController.listCollaborators(req.params.id as string);

    return res.status(StatusCode.OK).json(members ?? []);
  }

  // GET /pages/:id/collaborators/:collaboratorId -- detalhe do vínculo em page_collaborators.
  private async getCollaborator(req: Request, res: Response): Promise<Response> {
    const result = await pageCollaboratorController.getCollaborator(
      req.params.id as string,
      req.params.collaboratorId as string,
    );

    if (!result.ok) {
      return res.status(reasonToStatus(result.reason)).json({ message: result.message });
    }

    return res.status(StatusCode.OK).json(result.data);
  }

  // POST /pages/:id/collaborators -- adiciona em lote { userIds: [<ULID>, ...] }.
  private async addCollaborators(req: Request, res: Response): Promise<Response> {
    const { userIds } = (req.body ?? {}) as Input.AddPageCollaborators;

    const result = await pageCollaboratorController.addCollaborators(req.params.id as string, userIds);

    if (!result.ok) {
      return res.status(reasonToStatus(result.reason)).json({ message: result.message });
    }

    return res.status(StatusCode.CREATED).json(result.data);
  }

  // DELETE /pages/:id/collaborators/:collaboratorId -- remove um colaborador (collaboratorId = user_id).
  private async removeCollaborator(req: Request, res: Response): Promise<Response> {
    const result = await pageCollaboratorController.removeCollaborator(
      req.params.id as string,
      req.params.collaboratorId as string,
    );

    if (!result.ok) {
      return res.status(reasonToStatus(result.reason)).json({ message: result.message });
    }

    return res.status(StatusCode.NO_CONTENT).send();
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

    // Cobre rename E reordenação/edição de options: a coluna vai INTEIRA, do
    // jeito que ficou — o client substitui, não remenda. A sala é a parent
    // (`:id`), que é a tabela onde a coluna vive.
    realtimeService.emitColumnUpdated({
      pageId: req.params.id as string,
      columnId: req.params.column_id as string,
      column: result.data,
      updatedAt: new Date().toISOString(),
      originUserId: req.userId as string,
    });

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

    // Célula que NASCE é `cell-updated` como qualquer outra: para quem assiste,
    // "estava vazia, agora tem valor" é a mesma coisa que uma edição.
    await this.emitCell(req, body.value ?? null);

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

    await this.emitCell(req, body.value ?? null);

    return res.status(StatusCode.OK).json(result.data);
  }

  /**
   * Propaga uma célula para a sala da TABELA. O `:id` da rota é a LINHA (uma
   * página filha), mas quem tem a página aberta assinou a sala da PARENT — daí
   * a resolução do parent antes de emitir. Linha sem parent (não deveria
   * acontecer numa tabela) simplesmente não propaga, em vez de explodir.
   */
  private async emitCell(req: Request, value: unknown): Promise<void> {
    const rowId = req.params.id as string;
    const parentId = await pageAccessController.getParentId(rowId);
    if (!parentId) return;

    realtimeService.emitCellUpdated({
      pageId: parentId,
      rowId,
      columnId: req.params.column_id as string,
      value,
      updatedAt: new Date().toISOString(),
      originUserId: req.userId as string,
    });
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

    // Limpar a célula é uma atualização para `null` — mesmo evento, sem um
    // "cell-deleted" que o client teria de tratar como caso especial.
    await this.emitCell(req, null);

    return res.status(StatusCode.NO_CONTENT).send();
  }
}

export default new PageRouter().router;
