import type { Schema } from "@/models/schemas/index";

export type JsonRecord = Record<string, unknown>;

export interface PageViewPatchResult {
  viewId: string;
  view: JsonRecord;
  data: JsonRecord;
  changed: boolean;
}

export interface PageViewCreateResult {
  viewId: string;
  view: JsonRecord;
  data: JsonRecord;
}

export interface PageViewOrderResult {
  viewIds: string[];
  data: JsonRecord;
  changed: boolean;
}

export interface FilterWriteResult {
  viewId: string;
  filters: Schema.ViewFiltersV2;
  data: JsonRecord;
}

export interface FilterKeyCatalog {
  views: Array<{ id: string; urlKey: Schema.PublicKeyMetadata }>;
  columns: Array<{
    id: string;
    publicKey: Schema.PublicKeyMetadata;
    options: Array<{ id: string; publicKey: Schema.PublicKeyMetadata }>;
  }>;
}

export interface FilterKeyReconcileResult {
  pageId: string;
  data: JsonRecord;
  columns: Schema.PageColumn[];
  catalog: FilterKeyCatalog;
  changedPage: boolean;
  changedColumnIds: string[];
}

export type PageViewFailure = {
  ok: false;
  reason: "not_found" | "validation" | "conflict" | "server_error";
  message: string;
};
export type PageViewResult<T> = { ok: true; data: T } | PageViewFailure;
