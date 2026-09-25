import type { Schema } from "@/db/schemas/index";

export interface PageCellValueInput {
  value?: unknown;
  startDate?: string;
  endDate?: string;
}

export interface PageCellValueMapperContract {
  supports(column: Schema.PageColumn): boolean;
  encode(column: Schema.PageColumn, input: PageCellValueInput): string;
  decode(
    row: Schema.PageColumnValue,
    column: Schema.PageColumn,
  ): Schema.DecodedColumnValue;
}
