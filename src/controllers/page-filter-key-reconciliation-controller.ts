import { commitFilterKeyReconcile } from "@/repositories/page-json";
import type { ServiceResult } from "@/controllers/types/service-result.types";
import type {
  FilterKeyInspectionResult,
  FilterKeyReconcileResult,
} from "@/controllers/types/page-filter-key-reconciliation-controller.types";
import { FilterKeyReconciler } from "@/services/pages/views/filter-key-reconciler";
import { PageViewContextService } from "@/services/pages/views/page-view-context-service";

export type {
  FilterKeyCatalog,
  FilterKeyInspectionResult,
  FilterKeyReconcileResult,
} from "@/controllers/types/page-filter-key-reconciliation-controller.types";

/**
 * Repara, de forma idempotente, o catálogo de chaves públicas das views,
 * colunas, opções e filtros de uma página.
 */
export class PageFilterKeyReconciliationController {
  public constructor(
    private readonly contexts = new PageViewContextService(),
    private readonly reconciler = new FilterKeyReconciler(),
  ) {}

  /** Retorna o estado atual sem executar reparos ou qualquer escrita. */
  public async inspect(
    pageId: string,
  ): Promise<ServiceResult<FilterKeyInspectionResult>> {
    try {
      const context = await this.contexts.load(pageId);
      if (!context) {
        return { ok: false, reason: "not_found", message: "Página não encontrada" };
      }

      return {
        ok: true,
        data: {
          pageId,
          data: context.snapshot.data,
          columns: context.columns,
        },
      };
    } catch (error) {
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return { ok: false, reason: "server_error", message: "Erro no servidor" };
    }
  }

  public async reconcile(
    pageId: string,
  ): Promise<ServiceResult<FilterKeyReconcileResult>> {
    try {
      const context = await this.contexts.load(pageId);
      if (!context) {
        return { ok: false, reason: "not_found", message: "Página não encontrada" };
      }

      const plan = this.reconciler.plan(context.snapshot, context.columns);
      const committed = await commitFilterKeyReconcile({
        pageId,
        pagePatches: plan.pagePatches,
        columns: plan.columnUpdates,
      });
      if (!committed) {
        return { ok: false, reason: "server_error", message: "Erro no servidor" };
      }

      const snapshot =
        plan.pagePatches.length > 0
          ? await this.contexts.reloadSnapshot(pageId)
          : context.snapshot;
      const columns =
        plan.columnUpdates.length > 0
          ? await this.contexts.reloadColumns(pageId)
          : plan.reconciledColumns;
      if (!snapshot) {
        return { ok: false, reason: "server_error", message: "Erro no servidor" };
      }

      return {
        ok: true,
        data: {
          pageId,
          data: snapshot.data,
          columns,
          catalog: plan.catalog,
          changedPage: plan.pagePatches.length > 0,
          changedColumnIds: plan.columnUpdates.map((column) => column.id),
        },
      };
    } catch (error) {
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return { ok: false, reason: "server_error", message: "Erro no servidor" };
    }
  }
}

export default new PageFilterKeyReconciliationController();
