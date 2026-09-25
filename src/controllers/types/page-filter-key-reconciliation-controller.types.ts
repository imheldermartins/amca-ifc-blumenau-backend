import type { Schema } from "@/db/schemas/index";
import type { JsonRecord } from "@/services/types/json.types";
import type { FilterKeyCatalog } from "@/services/pages/views/types/page-view.types";

export type { FilterKeyCatalog } from "@/services/pages/views/types/page-view.types";

export interface FilterKeyInspectionResult {
  pageId: string;
  data: JsonRecord;
  columns: Schema.PageColumn[];
}

export interface FilterKeyReconcileResult {
  pageId: string;
  data: JsonRecord;
  columns: Schema.PageColumn[];
  catalog: FilterKeyCatalog;
  changedPage: boolean;
  changedColumnIds: string[];
}
