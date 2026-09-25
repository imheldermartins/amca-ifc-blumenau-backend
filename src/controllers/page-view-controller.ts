import {
  insertPageViewJson,
  updatePageJsonPaths,
  type PageJsonPathUpdate,
} from "@/repositories/page-json";
import type {
  PageViewCreateResult,
  PageViewDeleteResult,
  PageViewOrderResult,
  PageViewResult,
} from "@/controllers/types/page-view-controller.types";
import { PageViewContextService } from "@/services/pages/views/page-view-context-service";
import { PageViewFactory } from "@/services/pages/views/page-view-factory";
import {
  isJsonRecord,
  isUlid,
  parsePageViewCreate,
  parsePageViewOrder,
} from "@/services/pages/views/page-view-parsers";
import { ViewFiltersValidationError } from "@/services/view-filters-v2";

export type {
  JsonRecord,
  PageViewCreateResult,
  PageViewDeleteResult,
  PageViewFailure,
  PageViewOrderResult,
  PageViewResult,
} from "@/controllers/types/page-view-controller.types";

/**
 * Casos de uso do ciclo de vida de uma view.
 *
 * Alterações de configuração/filtros e a reconciliação de chaves públicas
 * pertencem a controladores próprios; este controller só cria, duplica,
 * remove e ordena views no snapshot da página.
 */
export class PageViewController {
  public constructor(
    private readonly contexts = new PageViewContextService(),
    private readonly factory = new PageViewFactory(),
  ) {}

  public async createView(
    pageId: string,
    raw: unknown,
    queryType?: unknown,
  ): Promise<PageViewResult<PageViewCreateResult>> {
    try {
      const input = parsePageViewCreate(raw, queryType);
      const context = await this.contexts.load(pageId);
      if (!context) {
        return { ok: false, reason: "not_found", message: "Página não encontrada" };
      }

      const draft = this.factory.create(context.snapshot, context.columns, input);
      const inserted = await insertPageViewJson(pageId, draft.viewId, draft.view);
      if (!inserted) {
        return {
          ok: false,
          reason: "conflict",
          message: "Não foi possível criar a view",
        };
      }

      const snapshot = await this.contexts.reloadSnapshot(pageId);
      const persisted = snapshot?.get(draft.viewId);
      if (!snapshot || !isJsonRecord(persisted)) {
        return { ok: false, reason: "server_error", message: "Erro no servidor" };
      }

      return {
        ok: true,
        data: { viewId: draft.viewId, view: persisted, data: snapshot.data },
      };
    } catch (error) {
      if (error instanceof ViewFiltersValidationError) {
        return { ok: false, reason: "validation", message: error.message };
      }
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return { ok: false, reason: "server_error", message: "Erro no servidor" };
    }
  }

  public async duplicateView(
    pageId: string,
    sourceViewId: string,
  ): Promise<PageViewResult<PageViewCreateResult>> {
    if (!isUlid(sourceViewId)) {
      return { ok: false, reason: "validation", message: "View inválida" };
    }

    try {
      const context = await this.contexts.load(pageId);
      if (!context) {
        return { ok: false, reason: "not_found", message: "Página não encontrada" };
      }

      const draft = this.factory.duplicate(context.snapshot, sourceViewId);
      if (!draft) {
        return { ok: false, reason: "not_found", message: "View não encontrada" };
      }

      const inserted = await insertPageViewJson(
        pageId,
        draft.viewId,
        draft.view,
        sourceViewId,
      );
      if (!inserted) {
        return {
          ok: false,
          reason: "conflict",
          message: "Não foi possível duplicar a view",
        };
      }

      const snapshot = await this.contexts.reloadSnapshot(pageId);
      const persisted = snapshot?.get(draft.viewId);
      if (!snapshot || !isJsonRecord(persisted)) {
        return { ok: false, reason: "server_error", message: "Erro no servidor" };
      }

      return {
        ok: true,
        data: { viewId: draft.viewId, view: persisted, data: snapshot.data },
      };
    } catch (error) {
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return { ok: false, reason: "server_error", message: "Erro no servidor" };
    }
  }

  public async deleteView(
    pageId: string,
    viewId: string,
  ): Promise<PageViewResult<PageViewDeleteResult>> {
    if (!isUlid(viewId)) {
      return { ok: false, reason: "validation", message: "View inválida" };
    }

    try {
      const context = await this.contexts.load(pageId);
      if (!context) {
        return { ok: false, reason: "not_found", message: "Página não encontrada" };
      }
      if (!context.snapshot.active(viewId)) {
        return { ok: false, reason: "not_found", message: "View não encontrada" };
      }

      const updated = await updatePageJsonPaths(
        pageId,
        [{ path: [viewId, "deletedAt"], value: new Date().toISOString() }],
        viewId,
      );
      if (!updated) {
        return { ok: false, reason: "not_found", message: "View não encontrada" };
      }

      const snapshot = await this.contexts.reloadSnapshot(pageId);
      if (!snapshot) {
        return { ok: false, reason: "server_error", message: "Erro no servidor" };
      }
      return { ok: true, data: { viewId, data: snapshot.data } };
    } catch (error) {
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return { ok: false, reason: "server_error", message: "Erro no servidor" };
    }
  }

  public async reorderViews(
    pageId: string,
    raw: unknown,
  ): Promise<PageViewResult<PageViewOrderResult>> {
    try {
      const requestedIds = parsePageViewOrder(raw);
      const context = await this.contexts.load(pageId);
      if (!context) {
        return { ok: false, reason: "not_found", message: "Página não encontrada" };
      }

      const activeIds = context.snapshot.activeEntries().map(([viewId]) => viewId);
      const activeIdSet = new Set(activeIds);
      if (
        requestedIds.length !== activeIds.length ||
        requestedIds.some((viewId) => !activeIdSet.has(viewId))
      ) {
        return {
          ok: false,
          reason: "conflict",
          message: "Catálogo de views desatualizado",
        };
      }

      const patches = requestedIds.flatMap<PageJsonPathUpdate>((viewId, order) => {
        const view = context.snapshot.active(viewId)!;
        return view.order === order ? [] : [{ path: [viewId, "order"], value: order }];
      });

      if (patches.length > 0) {
        const updated = await updatePageJsonPaths(
          pageId,
          patches,
          requestedIds,
          context.snapshot.data,
        );
        if (!updated) {
          return {
            ok: false,
            reason: "conflict",
            message: "Catálogo de views desatualizado",
          };
        }
      }

      return {
        ok: true,
        data: {
          viewIds: requestedIds,
          data: context.snapshot.withOrders(requestedIds),
          changed: patches.length > 0,
        },
      };
    } catch (error) {
      if (error instanceof ViewFiltersValidationError) {
        return { ok: false, reason: "validation", message: error.message };
      }
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return { ok: false, reason: "server_error", message: "Erro no servidor" };
    }
  }
}

export default new PageViewController();
