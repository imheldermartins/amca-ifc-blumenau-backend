import type {
  CellUpdatedPayload,
  ColumnCreatedPayload,
  ColumnPayload,
  ColumnUpdatedPayload,
  DatabaseUpdatedPayload,
  PageUpdatedPayload,
  RowPayload,
  RowUpdatedPayload,
  ServerToClientEvents,
  ViewUpdatedPayload,
} from "@core/socket/realtime-contract-v1";
import type { RealtimeChannel } from "@core/socket/realtime-channel";
import { roomForPage } from "@core/socket/page-room";
import type { CubsSocket, CubsSocketServer } from "@core/socket/socket-types";
import { authorizedPageDelivery, type PageEventDelivery } from './authorized-page-delivery.js';

export type PageEditEventName =
  | "cell-updated"
  | "row-updated"
  | "page-updated"
  | "database-updated"
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
    "database-updated",
    "column-updated",
    "view-updated",
    "row-created",
    "row-deleted",
    "column-created",
    "column-deleted",
  ] as const;

  private io: CubsSocketServer | null = null;

  constructor(private readonly deliver: PageEventDelivery = authorizedPageDelivery) {}

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

  emitDatabaseUpdated(payload: DatabaseUpdatedPayload): void {
    this.emit("database-updated", payload);
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
    this.deliver(this.io, event, payload);
  }
}

export const pageEditChannel = new PageEditChannel();
