import db from "@models/index";
import type { Schema } from "@/db/schemas/index";
import { pageActivityTouchStatement } from "@/db/repositories/page-activity";
import { pageColumnResetStatements } from "@/db/repositories/page-column-reset";
import pageColumnConfigurationService, {
  type PageColumnConfigurationService,
} from "@/services/pages/columns/page-column-configuration-service";
import pageColumnResetService, {
  type PageColumnResetService,
} from "@/services/pages/columns/page-column-reset-service";
import type { PageColumnResetResult } from "@/services/pages/columns/types/page-column-reset.types";
import type { ServiceResult } from "@/controllers/types/service-result.types";

export class PageColumnResetController {
  private readonly columns = db.pageColumns;
  private readonly values = db.pageColumnValues;

  public constructor(
    private readonly configuration: PageColumnConfigurationService = pageColumnConfigurationService,
    private readonly resetService: PageColumnResetService = pageColumnResetService,
  ) {}

  public async resetColumn(
    lookup: LookupValues<Schema.PageColumn>,
  ): Promise<ServiceResult<PageColumnResetResult>> {
    try {
      const existing = await this.columns.find(lookup);
      if (!existing) {
        return { ok: false, reason: "not_found", message: '"Page_column" não encontrado' };
      }
      if (!this.configuration.isColumnType(existing.type)) {
        return { ok: false, reason: "validation", message: "Tipo de coluna não suportado" };
      }

      const values =
        (await this.values.findAll({
          page_column_id: existing.id,
        } as LookupsConfig<Schema.PageColumnValue>)) ?? [];
      const plan = this.resetService.plan(existing, values);
      const updated = await this.columns.update(
        { data: plan.data } as UpdateValues<Schema.PageColumn>,
        lookup,
        {
          after: [
            ...pageColumnResetStatements(existing.id, plan.writes),
            ...[...new Set(plan.resetCells.map((cell) => cell.rowId))].map(
              pageActivityTouchStatement,
            ),
            ...(existing.parent_id ? [pageActivityTouchStatement(existing.parent_id)] : []),
          ],
        },
      );
      if (!updated) {
        return { ok: false, reason: "server_error", message: "Erro no servidor" };
      }

      const column = await this.columns.find(lookup);
      if (!column) {
        return { ok: false, reason: "server_error", message: "Erro no servidor" };
      }

      return {
        ok: true,
        data: { column, resetCells: plan.resetCells },
      };
    } catch (error) {
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return { ok: false, reason: "server_error", message: "Erro no servidor" };
    }
  }
}

export default new PageColumnResetController();
