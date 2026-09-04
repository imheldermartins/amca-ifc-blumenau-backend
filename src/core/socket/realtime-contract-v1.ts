/**
 * Protocolo realtime v1 do Cub's.
 *
 * Este arquivo e portátil de proposito: nao importa Socket.IO nem qualquer
 * modulo interno do backend. A copia do frontend e gerada diretamente dele,
 * portanto todo wire shape publico deve viver aqui.
 */

export const REALTIME_PROTOCOL_VERSION = 1 as const;

/** Metadados comuns a todo evento duravel de uma sala de pagina. */
export interface RealtimePayload {
  pageId: string;
  updatedAt: string;
  originUserId: string;
}

export interface EchoReply {
  message: string;
  userId: string;
  at: string;
}

export interface PageMembershipCommand {
  pageId: string;
}

export interface PresencePayload {
  pageId: string;
  count: number;
}

/** Preview efemero; a largura persistida chega em `view-updated`. */
export interface ColumnResizingPayload {
  pageId: string;
  viewId: string;
  columnId: string;
  width: number;
  originUserId: string;
}

export type ResizeColumnCommand = Omit<ColumnResizingPayload, "originUserId">;

export interface CellUpdatedPayload extends RealtimePayload {
  rowId: string;
  columnId: string;
  /** Valor sem o envelope `{ value }`; `null` representa celula vazia. */
  value: unknown;
}

export interface RowUpdatedPayload extends RealtimePayload {
  rowId: string;
  title: string | null;
}

export interface PageUpdatedPayload extends RealtimePayload {
  title: string | null;
}

export interface ColumnUpdatedPayload extends RealtimePayload {
  columnId: string;
  /** Definicao completa da coluna, nunca um patch. */
  column: unknown;
}

export interface ColumnCreatedPayload extends RealtimePayload {
  columnId: string;
  /** Coluna persistida completa para insercao incremental sem refetch. */
  column: unknown;
}

export interface ViewUpdatedPayload extends RealtimePayload {
  /** `pages.data` inteiro; snapshots sao substituidos, nao remendados. */
  data: unknown;
}

export interface RowPayload extends RealtimePayload {
  rowId: string;
}

export interface ColumnPayload extends RealtimePayload {
  columnId: string;
}

/** Eventos de pagina, separados dos eventos globais apenas para ownership. */
export interface RealtimeServerToClientEvents {
  "joined-page-database": (payload: PageMembershipCommand) => void;
  "page-database-denied": (payload: PageMembershipCommand) => void;
  "page-presence": (payload: PresencePayload) => void;
  "cell-updated": (payload: CellUpdatedPayload) => void;
  "row-updated": (payload: RowUpdatedPayload) => void;
  "page-updated": (payload: PageUpdatedPayload) => void;
  "column-updated": (payload: ColumnUpdatedPayload) => void;
  "column-resizing": (payload: ColumnResizingPayload) => void;
  "view-updated": (payload: ViewUpdatedPayload) => void;
  "row-created": (payload: RowPayload) => void;
  "row-deleted": (payload: RowPayload) => void;
  "column-created": (payload: ColumnCreatedPayload) => void;
  "column-deleted": (payload: ColumnPayload) => void;
}

export interface RealtimeClientToServerEvents {
  "join-page-database": (payload: PageMembershipCommand) => void;
  "leave-page-database": (payload: PageMembershipCommand) => void;
  "resize-column": (payload: ResizeColumnCommand) => void;
}

/** Contrato completo usado pelo `Server` e copiado para o frontend. */
export interface ServerToClientEvents extends RealtimeServerToClientEvents {
  "presence:count": (count: number) => void;
  "echo:reply": (payload: EchoReply) => void;
}

export interface ClientToServerEvents extends RealtimeClientToServerEvents {
  "echo:send": (message: string) => void;
}

/**
 * Os arrays abaixo sao deliberadamente literais e tipados. Eles permitem
 * conferir ownership sem depender de reflexao sobre interfaces TypeScript.
 */
export const REALTIME_CLIENT_TO_SERVER_EVENT_NAMES = [
  "echo:send",
  "join-page-database",
  "leave-page-database",
  "resize-column",
] as const satisfies readonly (keyof ClientToServerEvents)[];

export const REALTIME_SERVER_TO_CLIENT_EVENT_NAMES = [
  "presence:count",
  "echo:reply",
  "joined-page-database",
  "page-database-denied",
  "page-presence",
  "cell-updated",
  "row-updated",
  "page-updated",
  "column-updated",
  "column-resizing",
  "view-updated",
  "row-created",
  "row-deleted",
  "column-created",
  "column-deleted",
] as const satisfies readonly (keyof ServerToClientEvents)[];
