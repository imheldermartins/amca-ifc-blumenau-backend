import type { Schema } from "@/db/schemas/index";
import type { CellResetWrite } from "@/repositories/types/page-column-reset.types";
import { VALUE_CODECS } from "@/services/value-codec";
import { optionTombstones } from "@/services/filter-key-registry";
import {
  reconcilePublicKeyMetadata,
  sanitizePublicKeyMetadata,
} from "@/services/public-key";
import pageColumnConfigurationService, {
  type PageColumnConfigurationService,
} from "@/services/pages/columns/page-column-configuration-service";
import type {
  PageColumnResetCell,
  PageColumnResetPlan,
} from "@/services/pages/columns/types/page-column-reset.types";

const CELL_RESET: Record<Schema.ColumnType, { clear: true } | { clear: false; value: unknown }> = {
  text: { clear: false, value: "" },
  numeric: { clear: false, value: 0 },
  checkbox: { clear: false, value: false },
  select: { clear: true },
  date: { clear: true },
};

export class PageColumnResetService {
  public constructor(
    private readonly configuration: PageColumnConfigurationService = pageColumnConfigurationService,
  ) {}

  public plan(
    column: Schema.PageColumn,
    values: readonly Schema.PageColumnValue[],
  ): PageColumnResetPlan {
    const data = this.configuration.base(column.type);
    const publicKey = sanitizePublicKeyMetadata(column.data?.publicKey);
    data.publicKey = publicKey ?? reconcilePublicKeyMetadata(column.name, "coluna", null);

    const removedOptionKeys = optionTombstones(
      column.data?.options ?? [],
      new Set(),
      column.data?.reservedOptionKeys,
    );
    if (removedOptionKeys.length > 0) data.reservedOptionKeys = removedOptionKeys;

    const columnForValidation: Schema.PageColumn = { ...column, data };
    const { resetCells, writes } = this.planDivergingValues(columnForValidation, values);
    return { data, resetCells, writes };
  }

  private planDivergingValues(
    column: Schema.PageColumn,
    values: readonly Schema.PageColumnValue[],
  ): { resetCells: PageColumnResetCell[]; writes: CellResetWrite[] } {
    const codec = VALUE_CODECS[column.type];
    const reset = CELL_RESET[column.type];
    const resetCells: PageColumnResetCell[] = [];
    const writes: CellResetWrite[] = [];

    for (const row of values) {
      if (!row.page_id) continue;

      let valid = true;
      try {
        codec.validate(codec.decode(row.data as unknown as string), column);
      } catch {
        valid = false;
      }
      if (valid) continue;

      writes.push(
        reset.clear
          ? { id: row.id, clear: true }
          : { id: row.id, clear: false, data: codec.encode(reset.value) },
      );
      resetCells.push({
        rowId: row.page_id,
        value: reset.clear ? null : reset.value,
      });
    }

    return { resetCells, writes };
  }
}

export default new PageColumnResetService();
