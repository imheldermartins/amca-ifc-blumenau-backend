import {
  updatePageJsonPaths,
  updatePageViewFiltersJson,
} from "@/db/repositories/page-json";
import type { ServiceResult } from "@/controllers/types/service-result.types";
import type {
  FilterWriteResult,
  PageViewPatchResult,
} from "@/controllers/types/page-view-patch-controller.types";
import { PageViewContextService } from "@/services/pages/views/page-view-context-service";
import { PageViewPatchPlanner } from "@/services/pages/views/page-view-patch-planner";
import {
  isJsonRecord,
  isUlid,
  parsePageViewPatch,
  toFilterColumnDefinitions,
} from "@/services/pages/views/page-view-parsers";
import {
  parseViewFiltersWrite,
  ViewFiltersValidationError,
} from "@/services/view-filters-v2";

export type {
  FilterWriteResult,
  PageViewPatchResult,
} from "@/controllers/types/page-view-patch-controller.types";

/**
 * Atualiza a configuração de uma view existente.
 *
 * O planner calcula patches mínimos do snapshot; o controller coordena a
 * validação do contexto, o commit atômico e a resposta pós-commit.
 */
export class PageViewPatchController {
  public constructor(
    private readonly contexts = new PageViewContextService(),
    private readonly planner = new PageViewPatchPlanner(),
  ) {}

  public async patchView(
    pageId: string,
    viewId: string,
    raw: unknown,
  ): Promise<ServiceResult<PageViewPatchResult>> {
    try {
      const input = parsePageViewPatch(viewId, raw);
      const context = await this.contexts.load(pageId);
      if (!context) {
        return { ok: false, reason: "not_found", message: "Página não encontrada" };
      }

      const current = context.snapshot.active(viewId);
      if (!current) {
        return { ok: false, reason: "not_found", message: "View não encontrada" };
      }

      const { patches } = this.planner.plan(
        context.snapshot,
        context.columns,
        viewId,
        current,
        input,
      );
      if (patches.length > 0) {
        const updated = await updatePageJsonPaths(pageId, patches, viewId);
        if (!updated) {
          return { ok: false, reason: "not_found", message: "View não encontrada" };
        }
      }

      const snapshot =
        patches.length > 0
          ? await this.contexts.reloadSnapshot(pageId)
          : context.snapshot;
      const view = snapshot?.get(viewId);
      if (!snapshot || !isJsonRecord(view)) {
        return { ok: false, reason: "server_error", message: "Erro no servidor" };
      }

      return {
        ok: true,
        data: {
          viewId,
          view,
          data: snapshot.data,
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

  public async updateFilters(
    pageId: string,
    viewId: string,
    raw: unknown,
  ): Promise<ServiceResult<FilterWriteResult>> {
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

      const filters = parseViewFiltersWrite(
        raw,
        toFilterColumnDefinitions(context.columns),
        new Date().toISOString(),
      );
      const updated = await updatePageViewFiltersJson(
        pageId,
        viewId,
        filters as unknown as Record<string, unknown>,
      );
      if (!updated) {
        return { ok: false, reason: "not_found", message: "View não encontrada" };
      }

      const snapshot = await this.contexts.reloadSnapshot(pageId);
      if (!snapshot) {
        return { ok: false, reason: "server_error", message: "Erro no servidor" };
      }

      return {
        ok: true,
        data: { viewId, filters, data: snapshot.data },
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

export default new PageViewPatchController();
