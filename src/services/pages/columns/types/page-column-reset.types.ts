import type { CellResetWrite } from "@/repositories/types/page-column-reset.types";
import type { Schema } from "@/db/schemas/index";

export interface PageColumnResetCell {
  rowId: string;
  value: unknown;
}

export interface PageColumnResetPlan {
  data: Schema.PageColumnData;
  resetCells: PageColumnResetCell[];
  writes: CellResetWrite[];
}

export interface PageColumnResetResult {
  column: Schema.PageColumn;
  resetCells: PageColumnResetCell[];
}
