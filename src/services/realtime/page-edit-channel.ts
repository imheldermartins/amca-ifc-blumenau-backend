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
} from "@/services/realtime/contracts/realtime-contract-v1";
import type { RealtimeChannel } from "@/services/realtime/types/realtime-channel.types";
import type { CubsSocket, CubsSocketServer } from "@/services/realtime/types/socket.types";
import { authorizedPageDelivery } from "@/services/realtime/authorized-page-delivery";
import type { PageEditEventName, PageEventDelivery } from "@/services/realtime/types/page-edit.types";
export type { PageEditEventName, PageEventDelivery } from "@/services/realtime/types/page-edit.types";

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

  constructor(
    private readonly deliver: PageEventDelivery = authorizedPageDelivery.deliver.bind(authorizedPageDelivery),
  ) {}

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
