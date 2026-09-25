import type { Schema } from "@/db/schemas/index";

export interface FilterColumnDefinition {
  id: string;
  type: Schema.ColumnType;
  options?: readonly Schema.SelectOption[];
}
