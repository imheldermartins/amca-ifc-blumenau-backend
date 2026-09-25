import type { Schema } from "@/db/schemas/index";

export interface PageCellWrite {
  pageId: NonEmptyString;
  columnId: NonEmptyString;
  data: string;
}

export interface PageCellUpdate {
  cellId: NonEmptyString;
  pageId: NonEmptyString;
  data: string;
}

export interface PageCellStoreContract {
  findCell(pageId: NonEmptyString, columnId: NonEmptyString): Promise<Schema.PageColumnValue | null>;
  findColumnForCell(pageId: NonEmptyString, columnId: NonEmptyString): Promise<Schema.PageColumn | null>;
  createCell(input: PageCellWrite): Promise<Schema.PageColumnValue | null>;
  updateCell(input: PageCellUpdate): Promise<Schema.PageColumnValue | null>;
  deleteCell(cellId: NonEmptyString, pageId: NonEmptyString): Promise<boolean>;
}
