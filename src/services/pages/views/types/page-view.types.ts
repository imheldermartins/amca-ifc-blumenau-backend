import type { Schema } from "@/db/schemas/index";
import type {
  PageColumnJsonUpdate,
  PageJsonPathUpdate,
} from "@/db/types/page-json.types";
import type { JsonRecord } from "@/services/types/json.types";
import type { PageViewSnapshot } from "@/services/pages/views/page-view-snapshot";

export type PageViewKind =
  | "table"
  | "grid"
  | "board"
  | "calendar"
  | "timeline"
  | "graph";

export interface PageViewTitleInput {
  key: "title";
  column_name: string;
  mask?: Schema.TextMask;
}

export interface PageViewCreateInput {
  kind: PageViewKind;
  name: string;
  title: PageViewTitleInput;
}

export interface PageViewContext {
  page: Schema.Page;
  columns: Schema.PageColumn[];
  snapshot: PageViewSnapshot;
}

export interface PageViewDraft {
  viewId: string;
  view: JsonRecord;
}

export interface PageViewPatchPlan {
  patches: PageJsonPathUpdate[];
}

export interface FilterKeyCatalog {
  views: Array<{ id: string; urlKey: Schema.PublicKeyMetadata }>;
  columns: Array<{
    id: string;
    publicKey: Schema.PublicKeyMetadata;
    options: Array<{ id: string; publicKey: Schema.PublicKeyMetadata }>;
  }>;
}

export interface FilterKeyReconcilePlan {
  pagePatches: PageJsonPathUpdate[];
  columnUpdates: PageColumnJsonUpdate[];
  reconciledColumns: Schema.PageColumn[];
  catalog: FilterKeyCatalog;
}
