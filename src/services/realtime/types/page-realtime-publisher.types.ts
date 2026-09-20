import type {
  CellUpdatedPayload,
  ColumnCreatedPayload,
  ColumnPayload,
  ColumnUpdatedPayload,
  DatabaseUpdatedPayload,
  PageUpdatedPayload,
  RowPayload,
  RowUpdatedPayload,
  ViewUpdatedPayload,
} from "@/services/realtime/contracts/realtime-contract-v1";

export interface ParentPageResolver {
  getParentId(pageId: string): Promise<string | null>;
}

export interface DatabaseActivityReader {
  getUpdatedAt(pageId: string): Promise<string | null>;
}

export interface PageEditEmitter {
  emitCellUpdated(payload: CellUpdatedPayload): void;
  emitRowUpdated(payload: RowUpdatedPayload): void;
  emitPageUpdated(payload: PageUpdatedPayload): void;
  emitDatabaseUpdated(payload: DatabaseUpdatedPayload): void;
  emitColumnUpdated(payload: ColumnUpdatedPayload): void;
  emitViewUpdated(payload: ViewUpdatedPayload): void;
  emitRowCreated(payload: RowPayload): void;
  emitRowDeleted(payload: RowPayload): void;
  emitColumnCreated(payload: ColumnCreatedPayload): void;
  emitColumnDeleted(payload: ColumnPayload): void;
}

export interface PublishMetadataInput {
  originUserId: string;
}

export interface CellUpdatedInput extends PublishMetadataInput {
  rowId: string;
  columnId: string;
  value: unknown;
}

export interface PageChangedInput extends PublishMetadataInput {
  pageId: string;
  title?: string | null;
  data?: unknown;
}

export interface ColumnUpdatedInput extends PublishMetadataInput {
  pageId: string;
  columnId: string;
  column: unknown;
}

export interface RowChangedInput extends PublishMetadataInput {
  pageId: string;
  rowId: string;
}

export interface ColumnChangedInput extends PublishMetadataInput {
  pageId: string;
  columnId: string;
}

export interface ColumnCreatedInput extends ColumnChangedInput {
  column: unknown;
}

export interface ColumnResetInput extends ColumnUpdatedInput {
  cells: readonly { rowId: string; value: unknown }[];
}

export type RealtimePublisherLogger = (message: string, error: unknown) => void;
