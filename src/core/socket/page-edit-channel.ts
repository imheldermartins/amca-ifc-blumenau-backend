import type {
  CellUpdatedPayload,
  ColumnCreatedPayload,
  ColumnPayload,
  ColumnUpdatedPayload,
  PageUpdatedPayload,
  RowPayload,
  RowUpdatedPayload,
  ServerToClientEvents,
  ViewUpdatedPayload,
} from "@core/socket/realtime-contract-v1";
import type { RealtimeChannel } from "@core/socket/realtime-channel";
import { roomForPage } from "@core/socket/page-room";
import type { CubsSocket, CubsSocketServer } from "@core/socket/socket-types";

export type PageEditEventName =
  | "cell-updated"
  | "row-updated"
  | "page-updated"
  | "column-updated"
  | "view-updated"
  | "row-created"
  | "row-deleted"
  | "column-created"
  | "column-deleted";

/** Broadcasts duraveis. Nao registra escrita client -> server. */
export class PageEditChannel implements RealtimeChannel {
  readonly id = "page-edit";
  readonly clientEvents = [] as const;
  readonly serverEvents = [
    "cell-updated",
    "row-updated",
    "page-updated",
    "column-updated",
    "view-updated",
    "row-created",
    "row-deleted",
    "column-created",
    "column-deleted",
  ] as const;

  private io: CubsSocketServer | null = null;

  attach(io: CubsSocketServer): void {
    this.io = io;
  }

  register(_socket: CubsSocket): void {}

  emitCellUpdated(payload: CellUpdatedPayload): void {
    this.emit("cell-updated", payload);
  }

  emitRowUpdated(payload: RowUpdatedPayload): void {
    this.emit("row-updated", payload);
  }

  emitPageUpdated(payload: PageUpdatedPayload): void {
    this.emit("page-updated", payload);
  }

  emitColumnUpdated(payload: ColumnUpdatedPayload): void {
    this.emit("column-updated", payload);
  }

  emitViewUpdated(payload: ViewUpdatedPayload): void {
    this.emit("view-updated", payload);
  }

  emitRowCreated(payload: RowPayload): void {
    this.emit("row-created", payload);
  }

  emitRowDeleted(payload: RowPayload): void {
    this.emit("row-deleted", payload);
  }

  emitColumnCreated(payload: ColumnCreatedPayload): void {
    this.emit("column-created", payload);
  }

  emitColumnDeleted(payload: ColumnPayload): void {
    this.emit("column-deleted", payload);
  }

  private emit<E extends PageEditEventName>(
    event: E,
    payload: Parameters<ServerToClientEvents[E]>[0],
  ): void {
    if (!this.io) {
      throw new Error("PageEditChannel não foi anexado ao SocketServer");
    }
    const room = this.io.to(roomForPage(payload.pageId)) as unknown as {
      emit(event: E, payload: Parameters<ServerToClientEvents[E]>[0]): void;
    };
    room.emit(event, payload);
  }
}

export const pageEditChannel = new PageEditChannel();
