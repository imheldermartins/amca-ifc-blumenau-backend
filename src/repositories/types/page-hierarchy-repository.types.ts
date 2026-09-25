import type { Schema } from "@/db/schemas/index";

export type PageChildCreationData = Partial<Pick<Schema.Page, "title" | "data">>;

export interface ParentPageRow {
  parent_id: NonEmptyString;
}

export interface PageDatasetDatabaseRow {
  page_id: NonEmptyString;
  page_title: string | null;
  page_columns: string;
}

export interface PageDatasetRow {
  page_id: NonEmptyString;
  page_title: string | null;
  page_columns: Record<string, unknown>;
}

export interface PageBreadcrumbRow {
  id: NonEmptyString;
  parent_id: NonEmptyString;
  depth: number;
}
