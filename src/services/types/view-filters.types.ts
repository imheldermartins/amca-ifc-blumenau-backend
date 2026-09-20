import type { Schema } from "@/models/schemas/index";

export interface FilterColumnDefinition {
  id: string;
  type: Schema.ColumnType;
  options?: readonly Schema.SelectOption[];
}
