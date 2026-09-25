import type { Schema } from "@/db/schemas/index";
import type { JsonRecord } from "@/services/types/json.types";

export interface PageViewPatchResult {
  viewId: string;
  view: JsonRecord;
  data: JsonRecord;
  changed: boolean;
}

export interface FilterWriteResult {
  viewId: string;
  filters: Schema.ViewFiltersV2;
  data: JsonRecord;
}
