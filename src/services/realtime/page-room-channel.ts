import accessStore from '@/repositories/scoped-access-repository';
import { pageRoom, type PageRoom } from "@/services/realtime/rooms/page-room";
import type { RealtimeChannel } from "@/services/realtime/types/realtime-channel.types";
import type { CubsSocket, CubsSocketServer } from "@/services/realtime/types/socket.types";
import type { DeferredTaskScheduler, PageAccessAuthorizer } from "@/services/realtime/types/page-room-channel.types";
export type { DeferredTaskScheduler, PageAccessAuthorizer } from "@/services/realtime/types/page-room-channel.types";

export class PageRoomChannel implements RealtimeChannel {
  readonly id = "page-room";
  readonly clientEvents = ["join-page-database", "leave-page-database"] as const;
  readonly serverEvents = [
    "joined-page-database",
    "page-database-denied",
    "page-presence",
  ] as const;

  private io: CubsSocketServer | null = null;

  constructor(
    private readonly access: PageAccessAuthorizer = {canAccessPage: (userId,pageId) => accessStore.can('page',pageId,userId,'read','subpages')},
    private readonly defer: DeferredTaskScheduler = setImmediate,
    private readonly room: PageRoom = pageRoom,
  ) {}

  attach(io: CubsSocketServer): void {
    this.io = io;
  }

  register(socket: CubsSocket): void {
    socket.on("join-page-database", async (payload) => {
      const pageId = this.room.readIdentifier(payload);
      if (!pageId) return;

      let allowed = false;
      try {
        allowed = await this.access.canAccessPage(socket.data.userId, pageId);
      } catch (error) {
        console.error(
          `[cubs:realtime] Falha ao autorizar a pagina ${pageId}: ${this.formatError(error)}`,
        );
      }

      if (!allowed) {
        socket.emit("page-database-denied", { pageId });
        return;
      }

      await socket.join(this.room.name(pageId));
      socket.emit("joined-page-database", { pageId });
      this.broadcastPresence(pageId);
    });

    socket.on("leave-page-database", async (payload) => {
      const pageId = this.room.readIdentifier(payload);
      if (!pageId) return;
      await socket.leave(this.room.name(pageId));
      this.broadcastPresence(pageId);
    });

    socket.on("disconnecting", () => {
      const pageIds = [...socket.rooms]
        .map((roomName) => this.room.identifierFrom(roomName))
        .filter((pageId): pageId is string => pageId !== null);

      // No `disconnecting` o adapter ainda contem o socket. Recontar no
      // proximo turno garante que o Socket.IO ja tenha esvaziado as rooms.
      for (const pageId of pageIds) {
        this.defer(() => this.broadcastPresence(pageId));
      }
    });
  }

  /** Quantos sockets autorizados estao olhando a pagina. */
  broadcastPresence(pageId: string): void {
    if (!this.io) return;
    const count = this.io.sockets.adapter.rooms.get(this.room.name(pageId))?.size ?? 0;
    const room = this.io.to(this.room.name(pageId)) as unknown as {
      emit(event: "page-presence", payload: { pageId: string; count: number }): void;
    };
    room.emit("page-presence", { pageId, count });
  }

  private formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

export const pageRoomChannel = new PageRoomChannel();
