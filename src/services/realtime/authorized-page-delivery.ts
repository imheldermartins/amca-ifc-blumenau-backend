import access from "@db/scoped-access-store";
import { pageRoom, type PageRoom } from "@/services/realtime/rooms/page-room";
import type { ServerToClientEvents } from "@/services/realtime/contracts/realtime-contract-v1";
import type { CubsSocketServer } from "@/services/realtime/types/socket.types";
import type { PageEditEventName } from "@/services/realtime/types/page-edit.types";

export class AuthorizedPageDelivery {
  private readonly queues = new Map<string, Promise<void>>();

  public constructor(private readonly room: PageRoom = pageRoom) {}

  public deliver(
    io: CubsSocketServer,
    event: PageEditEventName,
    payload: Parameters<ServerToClientEvents[PageEditEventName]>[0],
  ): void {
    const previous = this.queues.get(payload.pageId) ?? Promise.resolve();
    const task = previous
      .then(() => this.deliverToAuthorizedSockets(io, event, payload))
      .catch(() => console.error("[cubs:realtime] Não foi possível confirmar as permissões da entrega."));

    this.queues.set(payload.pageId, task);
    void task.finally(() => {
      if (this.queues.get(payload.pageId) === task) this.queues.delete(payload.pageId);
    });
  }

  private async deliverToAuthorizedSockets(
    io: CubsSocketServer,
    event: PageEditEventName,
    payload: Parameters<ServerToClientEvents[PageEditEventName]>[0],
  ): Promise<void> {
    const roomName = this.room.name(payload.pageId);
    for (const socketId of [...(io.sockets.adapter.rooms.get(roomName) ?? [])]) {
      const socket = io.sockets.sockets.get(socketId);
      if (!socket || !this.room.contains(socket, payload.pageId)) continue;
      if (!await access.can("page", payload.pageId, socket.data.userId, "read", "subpages")) {
        await socket.leave(roomName);
        socket.emit("page-database-denied", { pageId: payload.pageId });
        continue;
      }

      const needsRowAuthorization = "rowId" in payload
        && event !== "row-created"
        && event !== "row-deleted";
      if (needsRowAuthorization && !await access.can("page", payload.rowId, socket.data.userId, "read", "view")) {
        continue;
      }

      const target = socket as unknown as {
        emit(event: PageEditEventName, eventPayload: unknown): void;
      };
      target.emit(event, payload);
    }
  }
}

export const authorizedPageDelivery = new AuthorizedPageDelivery();
