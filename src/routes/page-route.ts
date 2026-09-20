import scopedAccess from "@db/scoped-access-store";
import { requireScopedPermission } from "@/services/auth/scoped-access-middleware";
import roleStore from "@db/role-store";
import type { Request, Response } from "express";
import pageController from "@/controllers/page-controller";
import { readPageLatestUpdatedAt } from '@db/page-activity';
import pageColumnController from "@/controllers/page-column-controller";
import pageColumnValueController from "@/controllers/page-column-value-controller";
import pageCollaboratorController from "@/controllers/page-collaborator-controller";
import pageViewController from "@/controllers/page-view-controller";
import type { Schema } from "@/models/schemas/index";
import type { Input } from "@/models/schemas/inputs";
import { BaseRouter } from "@routes/base-router";
import middleware from "@/services/auth/middleware";
import { requirePageAccess } from "@/services/auth/page-access-middleware";
import pageAccessController from "@/controllers/page-access-controller";
import pageRealtimePublisher from "@/services/realtime/page-realtime-publisher";
import { StatusCode } from "@/services/http/status-code";

/**
 * Pages: CRUD completo protegido por JWT. O `owner_id` SEMPRE vem do token
 * (req.userId), nunca do payload, e as leituras/escritas são escopadas ao dono.
 * As rotas adicionais (motor de páginas) são registradas ao lado do CRUD base,
 * sem alterar o BaseRouter.
 */
export class PageRouter extends BaseRouter<Schema.Page> {
  protected readonly resourceName = "Page";

  constructor() {
    super(pageController, {
      all: [middleware.handle],
      get: [middleware.handle, requirePageAccess()],
      create: [middleware.handle],
      update: [middleware.handle, requireScopedPermission("page", "write", "update")],
      delete: [middleware.handle, requireScopedPermission("page", "write", "delete")],
    });
  }

  protected override registerRoutes(): void {
    super.registerRoutes();

    // Rotas adicionais (registradas após o CRUD base do super()). O
    // `requirePageAccess` é o guarda de dono-ou-colaborador (herdado pela árvore).
    this.router.post("/:id/page", middleware.handle, requireScopedPermission("page", "write", "create"), this.createChild.bind(this));
    this.router.get("/:id/page", middleware.handle, requirePageAccess(), this.getDataset.bind(this));
    this.router.get("/:id/breadcrumb", middleware.handle, requirePageAccess(), this.getBreadcrumb.bind(this));

    // Colaboradores (page_collaborators): acesso N:N à página. Adição em lote; leitura e
    // remoção unitárias por :collaboratorId (= user_id).
    this.router.get("/:id/collaborators", middleware.handle, requireScopedPermission("page", "read", "members"), this.listCollaborators.bind(this));
    this.router.get("/:id/collaborator-candidates", middleware.handle, requireScopedPermission("page", "write", "add_members"), this.listCollaboratorCandidates.bind(this));
    this.router.get("/:id/collaborators/:collaboratorId", middleware.handle, requireScopedPermission("page", "read", "members"), this.getCollaborator.bind(this));
    this.router.post("/:id/collaborators", middleware.handle, requireScopedPermission("page", "write", "add_members"), this.addCollaborators.bind(this));
    this.router.delete("/:id/collaborators/:collaboratorId", middleware.handle, requireScopedPermission("page", "write", "promote_members"), this.removeCollaborator.bind(this));

    // Configuração de view. Filtros têm endpoint semântico próprio; os demais
    // campos usam patch por caminho para nunca reescrever `pages.data` inteiro.
    this.router.post("/:id/views", middleware.handle, requireScopedPermission("page", "write", "update"), this.createView.bind(this));
    this.router.post("/:id/views/:viewId/duplicate", middleware.handle, requireScopedPermission("page", "write", "update"), this.duplicateView.bind(this));
    this.router.put("/:id/views/order", middleware.handle, requireScopedPermission("page", "write", "update"), this.reorderViews.bind(this));
    this.router.put("/:id/views/:viewId/filters", middleware.handle, requireScopedPermission("page", "write", "update"), this.updateViewFilters.bind(this));
    this.router.patch("/:id/views/:viewId", middleware.handle, requireScopedPermission("page", "write", "update"), this.patchView.bind(this));
    this.router.delete("/:id/views/:viewId", middleware.handle, requireScopedPermission("page", "write", "update"), this.deleteView.bind(this));
    this.router.post("/:id/filter-keys/reconcile", middleware.handle, requirePageAccess(), this.reconcileFilterKeys.bind(this));

    // Colunas da página parent (:id = id da parent). page_columns não tem rota própria.
    this.router.post("/parent/:id/columns", middleware.handle, requireScopedPermission("page", "write", "update"), this.createColumn.bind(this));
    this.router.get("/parent/:id/columns", middleware.handle, requirePageAccess(), this.listColumns.bind(this));
    this.router.get("/parent/:id/columns/:column_id", middleware.handle, requirePageAccess(), this.getColumn.bind(this));
    this.router.put("/parent/:id/columns/:column_id", middleware.handle, requireScopedPermission("page", "write", "update"), this.updateColumn.bind(this));
    this.router.post("/parent/:id/columns/:column_id/reset", middleware.handle, requireScopedPermission("page", "write", "update"), this.resetColumn.bind(this));
    this.router.delete("/parent/:id/columns/:column_id", middleware.handle, requireScopedPermission("page", "write", "update"), this.deleteColumn.bind(this));

    // Valor (célula) de uma coluna numa página (:id = page_id da linha, :column_id = coluna).
    // Singular: a célula (página, coluna) tem no máximo UM valor (UNIQUE no banco).
    this.router.post("/:id/column/:column_id/value", middleware.handle, requireScopedPermission("page", "write", "update"), this.createValue.bind(this));
    this.router.get("/:id/column/:column_id/value", middleware.handle, requirePageAccess(), this.getValue.bind(this));
    this.router.put("/:id/column/:column_id/value", middleware.handle, requireScopedPermission("page", "write", "update"), this.updateValue.bind(this));
    this.router.delete("/:id/column/:column_id/value", middleware.handle, requireScopedPermission("page", "write", "update"), this.deleteValue.bind(this));
  }

  /**
   * `GET /pages/shared` é caminho FIXO e precisa vencer o `GET /:id` do CRUD —
   * registrado aqui porque `BaseRouter.registerRoutes()` chama `staticRoutes`
   * antes do CRUD (era exatamente o bug: a aba
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

    return res.status(StatusCode.OK).json({
      ...item,
      latest_updated_at: await readPageLatestUpdatedAt(item.id),
    });
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

    const parentId = await pageAccessController.getParentId(req.params.id as string);
    const item = await pageController.update(
      { id: req.params.id } as LookupValues<Schema.Page>,
      payload,
      parentId ? [parentId] : [],
    );

    if (!item) {
      return res.status(StatusCode.NOT_FOUND).json({ message: `"${this.resourceName}" não encontrado ou falha ao atualizar` });
    }

    // Publicação pós-commit: um único método semântico roteia snapshot para a
    // própria página e título para a própria página + parent, com o mesmo
    // relógio. A rota não conhece rooms, nomes de evento ou Socket.IO.
    await pageRealtimePublisher.pageChanged({
      pageId: req.params.id as string,
      ...(data !== undefined && { data: item.data }),
      ...(title !== undefined && { title: item.title }),
      originUserId: req.userId as string,
    });

    return res.status(StatusCode.OK).json(item);
  }

  protected override async delete(req: Request, res: Response): Promise<Response> {
    const rowId = req.params.id as string;
    // Capture a sala antes do soft delete; publique somente após o commit.
    const parentId = await pageAccessController.getParentId(rowId);
    const deleted = await pageController.delete(
      { id: rowId } as LookupValues<Schema.Page>,
      parentId ? [parentId] : [],
    );

    if (!deleted) {
      return res.status(StatusCode.NOT_FOUND).json({ message: `"${this.resourceName}" não encontrado` });
    }

    if (parentId) {
      await pageRealtimePublisher.rowDeleted({
        pageId: parentId,
        rowId,
        originUserId: req.userId as string,
      });
    }

    return res.status(StatusCode.NO_CONTENT).send();
  }
  
  private async createChild(req: Request, res: Response): Promise<Response> {
    const body = (req.body ?? {}) as Input.CreateChildPage;
    const child = await pageController.createChild(req.params.id as string, req.userId!, body);

    if (!child) {
      return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Erro no servidor" });
    }

    await pageRealtimePublisher.rowCreated({
      pageId: req.params.id as string,
      rowId: child.id,
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
    if (!await scopedAccess.can("page", req.params.id as string, req.userId!, "read", "subpages")) return res.json([]);
    const dataset = await pageController.getDataset(req.params.id as string);

    if (!dataset) {
      return res.status(StatusCode.NOT_FOUND).json({ message: `"${this.resourceName}" não encontrado` });
    }

    const visible = await Promise.all(dataset.map(async row => await scopedAccess.can("page", row.page_id, req.userId!, "read", "view") ? row : null));
    return res.status(StatusCode.OK).json(visible.filter(Boolean));
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
      return res.status(this.reasonToStatus(result.reason)).json({ message: result.message });
    }

    return res.status(StatusCode.OK).json(result.data);
  }

  // POST /pages/:id/collaborators -- adiciona em lote { userIds: [<ULID>, ...] }.
  private async addCollaborators(req: Request, res: Response): Promise<Response> {
    return res.status(StatusCode.CONFLICT).json({
      message: "A entrada exige aceite. Use POST /access/page/:id/invites com e-mail ou link.",
    });
  }

  // DELETE /pages/:id/collaborators/:collaboratorId -- remove um colaborador (collaboratorId = user_id).
  private async removeCollaborator(req: Request, res: Response): Promise<Response> {
    const saved = await roleStore.removeMember("page", req.params.id as string, req.userId!, req.params.collaboratorId as string);
    return saved ? res.status(StatusCode.NO_CONTENT).send() : res.status(StatusCode.FORBIDDEN).json({ message: "Acesso não permitido" });
  }

  private async listCollaboratorCandidates(req: Request, res: Response): Promise<Response> {
    const result = await pageCollaboratorController.listCandidates(
      req.params.id as string,
      req.query.q,
    );
    if (!result.ok) {
      return res.status(this.reasonToStatus(result.reason)).json({ message: result.message });
    }
    return res.status(StatusCode.OK).json(result.data);
  }

  private async createView(req: Request, res: Response): Promise<Response> {
    const result = await pageViewController.createView(
      req.params.id as string,
      req.body,
      req.query.type,
    );
    if (!result.ok) {
      return res.status(this.reasonToStatus(result.reason)).json({ message: result.message });
    }
    await pageRealtimePublisher.pageChanged({
      pageId: req.params.id as string,
      data: result.data.data,
      originUserId: req.userId as string,
    });
    return res.status(StatusCode.CREATED).json({
      viewId: result.data.viewId,
      view: result.data.view,
    });
  }

  private async duplicateView(req: Request, res: Response): Promise<Response> {
    const result = await pageViewController.duplicateView(req.params.id as string, req.params.viewId as string);
    if (!result.ok) return res.status(this.reasonToStatus(result.reason)).json({ message: result.message });
    await pageRealtimePublisher.pageChanged({
      pageId: req.params.id as string,
      data: result.data.data,
      originUserId: req.userId as string,
    });
    return res.status(StatusCode.CREATED).json({ viewId: result.data.viewId, view: result.data.view });
  }

  private async deleteView(req: Request, res: Response): Promise<Response> {
    const result = await pageViewController.deleteView(req.params.id as string, req.params.viewId as string);
    if (!result.ok) return res.status(this.reasonToStatus(result.reason)).json({ message: result.message });
    await pageRealtimePublisher.pageChanged({
      pageId: req.params.id as string,
      data: result.data.data,
      originUserId: req.userId as string,
    });
    return res.status(StatusCode.NO_CONTENT).send();
  }

  private async updateViewFilters(req: Request, res: Response): Promise<Response> {
    const result = await pageViewController.updateFilters(
      req.params.id as string,
      req.params.viewId as string,
      req.body,
    );
    if (!result.ok) {
      return res.status(this.reasonToStatus(result.reason)).json({ message: result.message });
    }

    await pageRealtimePublisher.pageChanged({
      pageId: req.params.id as string,
      data: result.data.data,
      originUserId: req.userId as string,
    });
    return res.status(StatusCode.OK).json({
      viewId: result.data.viewId,
      filters: result.data.filters,
    });
  }

  private async reorderViews(req: Request, res: Response): Promise<Response> {
    const result = await pageViewController.reorderViews(req.params.id as string, req.body);
    if (!result.ok) return res.status(this.reasonToStatus(result.reason)).json({ message: result.message });
    if (result.data.changed) {
      await pageRealtimePublisher.pageChanged({
        pageId: req.params.id as string,
        data: result.data.data,
        originUserId: req.userId as string,
      });
    }
    return res.status(StatusCode.OK).json({ viewIds: result.data.viewIds });
  }

  private async patchView(req: Request, res: Response): Promise<Response> {
    const result = await pageViewController.patchView(
      req.params.id as string,
      req.params.viewId as string,
      req.body,
    );
    if (!result.ok) {
      return res.status(this.reasonToStatus(result.reason)).json({ message: result.message });
    }

    if (result.data.changed) {
      await pageRealtimePublisher.pageChanged({
        pageId: req.params.id as string,
        data: result.data.data,
        originUserId: req.userId as string,
      });
    }
    return res.status(StatusCode.OK).json({
      viewId: result.data.viewId,
      view: result.data.view,
    });
  }

  private async reconcileFilterKeys(req: Request, res: Response): Promise<Response> {
    if (!await scopedAccess.can("page", req.params.id as string, req.userId!, "write", "update")) {
      const page = await pageController.get({id: req.params.id} as LookupValues<Schema.Page>);
      const columns = await pageColumnController.all({ parent_id: req.params.id } as LookupsConfig<Schema.PageColumn>);
      return res.status(StatusCode.OK).json({pageId:req.params.id,data:page?.data ?? {},columns:columns ?? []});
    }
    const result = await pageViewController.reconcile(req.params.id as string);
    if (!result.ok) {
      return res.status(this.reasonToStatus(result.reason)).json({ message: result.message });
    }

    const columnsById = new Map(result.data.columns.map((column) => [String(column.id), column]));
    for (const columnId of result.data.changedColumnIds) {
      const column = columnsById.get(columnId);
      if (!column) continue;
      await pageRealtimePublisher.columnUpdated({
        pageId: req.params.id as string,
        columnId,
        column,
        originUserId: req.userId as string,
      });
    }
    if (result.data.changedPage) {
      await pageRealtimePublisher.pageChanged({
        pageId: req.params.id as string,
        data: result.data.data,
        originUserId: req.userId as string,
      });
    }

    return res.status(StatusCode.OK).json({
      pageId: result.data.pageId,
      data: result.data.data,
      columns: result.data.columns,
      catalog: result.data.catalog,
    });
  }

  // --- Colunas da página parent (page_columns; :id = id da página parent) ---

  // POST /pages/parent/:id/columns?type=<type> -- type vem da query; parent_id da URL.
  private async createColumn(req: Request, res: Response): Promise<Response> {
    const body = (req.body ?? {}) as Input.CreatePageColumn;
    const type = this.resolveTypeQuery(req) ?? body.type;

    const result = await pageColumnController.createColumn({
      ...(body.name !== undefined && { name: body.name }),
      ...(body.options !== undefined && { options: body.options }),
      ...(body.format !== undefined && { format: body.format }),
      ...(body.currency !== undefined && { currency: body.currency }),
      ...(body.mask !== undefined && { mask: body.mask }),
      ...(type !== undefined && { type }),
      parent_id: req.params.id as Schema.PageColumn["parent_id"],
    });

    if (!result.ok) {
      return res.status(this.reasonToStatus(result.reason)).json({ message: result.message });
    }

    await pageRealtimePublisher.columnCreated({
      pageId: req.params.id as string,
      columnId: result.data.id,
      column: result.data,
      originUserId: req.userId as string,
    });

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
    const type = this.resolveTypeQuery(req) ?? body.type;

    const input: Input.UpdatePageColumn = {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.options !== undefined && { options: body.options }),
      ...(body.format !== undefined && { format: body.format }),
      ...(body.currency !== undefined && { currency: body.currency }),
      ...(body.mask !== undefined && { mask: body.mask }),
      ...(type !== undefined && { type }),
    };

    const result = await pageColumnController.updateColumn(
      { id: req.params.column_id, parent_id: req.params.id } as LookupValues<Schema.PageColumn>,
      input,
    );

    if (!result.ok) {
      return res.status(this.reasonToStatus(result.reason)).json({ message: result.message });
    }

    await pageRealtimePublisher.columnUpdated({
      pageId: req.params.id as string,
      columnId: req.params.column_id as string,
      column: result.data,
      originUserId: req.userId as string,
    });

    return res.status(StatusCode.OK).json(result.data);
  }

  // POST /pages/parent/:id/columns/:column_id/reset -- "reset de tipos".
  private async resetColumn(req: Request, res: Response): Promise<Response> {
    const result = await pageColumnController.resetColumn(
      { id: req.params.column_id, parent_id: req.params.id } as LookupValues<Schema.PageColumn>,
    );

    if (!result.ok) {
      return res.status(this.reasonToStatus(result.reason)).json({ message: result.message });
    }

    const { column, resetCells } = result.data;
    await pageRealtimePublisher.columnReset({
      pageId: req.params.id as string,
      columnId: req.params.column_id as string,
      column,
      cells: resetCells,
      originUserId: req.userId as string,
    });

    return res.status(StatusCode.OK).json(column);
  }

  // DELETE /pages/parent/:id/columns/:column_id -- soft delete (`deleted_at`).
  private async deleteColumn(req: Request, res: Response): Promise<Response> {
    const result = await pageColumnController.deleteColumn(
      { id: req.params.column_id, parent_id: req.params.id } as LookupValues<Schema.PageColumn>,
    );

    if (!result.ok) {
      return res.status(this.reasonToStatus(result.reason)).json({ message: result.message });
    }

    await pageRealtimePublisher.columnDeleted({
      pageId: req.params.id as string,
      columnId: req.params.column_id as string,
      originUserId: req.userId as string,
    });

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
      return res.status(this.reasonToStatus(result.reason)).json({ message: result.message });
    }

    // Célula que NASCE é `cell-updated` como qualquer outra: para quem assiste,
    // "estava vazia, agora tem valor" é a mesma coisa que uma edição.
    // O evento leva a fonte de verdade confirmada pelo codec. Para `date`, por
    // exemplo, `{ startDate, endDate }` é persistido como `start@end`; olhar
    // apenas `body.value` emitia `null` apesar de o banco conter o range.
    await this.emitCell(req, result.data.value);

    return res.status(StatusCode.CREATED).json(result.data);
  }

  // GET /pages/:id/column/:column_id/value -- lê o valor da célula (404 se vazia).
  private async getValue(req: Request, res: Response): Promise<Response> {
    const result = await pageColumnValueController.getValue(
      req.params.id as string,
      req.params.column_id as string,
    );

    if (!result.ok) {
      return res.status(this.reasonToStatus(result.reason)).json({ message: result.message });
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
      return res.status(this.reasonToStatus(result.reason)).json({ message: result.message });
    }

    await this.emitCell(req, result.data.value);

    return res.status(StatusCode.OK).json(result.data);
  }

  /** Publica a célula confirmada; o publisher resolve a parent/room da linha. */
  private async emitCell(req: Request, value: unknown): Promise<void> {
    await pageRealtimePublisher.cellUpdated({
      rowId: req.params.id as string,
      columnId: req.params.column_id as string,
      value,
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
      return res.status(this.reasonToStatus(result.reason)).json({ message: result.message });
    }

    // Limpar a célula é uma atualização para `null` — mesmo evento, sem um
    // "cell-deleted" que o client teria de tratar como caso especial.
    await this.emitCell(req, null);

    return res.status(StatusCode.NO_CONTENT).send();
  }

  private reasonToStatus(reason: ServiceFailureReason): number {
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
  }

  private resolveTypeQuery(req: Request): Schema.ColumnType | undefined {
    const raw = req.query.type;
    const value = typeof raw === "string" ? raw : undefined;
    return value === "number" ? "numeric" : (value as Schema.ColumnType | undefined);
  }
}

export default new PageRouter().build();
