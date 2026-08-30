import pageAccessController from "@/controllers/page-access-controller";
import { pageIdFromRoom, readPageId, roomForPage } from "@core/socket/page-room";
import type { RealtimeChannel } from "@core/socket/realtime-channel";
import type { CubsSocket, CubsSocketServer } from "@core/socket/socket-types";

export interface PageAccessAuthorizer {
  canAccessPage(userId: string, pageId: string): Promise<boolean>;
}

export type DeferredTaskScheduler = (task: () => void) => void;

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
    private readonly access: PageAccessAuthorizer = pageAccessController,
    private readonly defer: DeferredTaskScheduler = setImmediate,
  ) {}

  attach(io: CubsSocketServer): void {
    this.io = io;
  }

  register(socket: CubsSocket): void {
    socket.on("join-page-database", async (payload) => {
      const pageId = readPageId(payload);
      if (!pageId) return;

      let allowed = false;
      try {
        allowed = await this.access.canAccessPage(socket.data.userId, pageId);
      } catch (error) {
        console.error(
          `[cubs:realtime] Falha ao autorizar a pagina ${pageId}: ${formatError(error)}`,
        );
      }

      if (!allowed) {
        socket.emit("page-database-denied", { pageId });
        return;
      }

      await socket.join(roomForPage(pageId));
      socket.emit("joined-page-database", { pageId });
      this.broadcastPresence(pageId);
    });

    socket.on("leave-page-database", async (payload) => {
      const pageId = readPageId(payload);
      if (!pageId) return;
      await socket.leave(roomForPage(pageId));
      this.broadcastPresence(pageId);
    });

    socket.on("disconnecting", () => {
      const pageIds = [...socket.rooms]
        .map(pageIdFromRoom)
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
    const count = this.io.sockets.adapter.rooms.get(roomForPage(pageId))?.size ?? 0;
    const room = this.io.to(roomForPage(pageId)) as unknown as {
      emit(event: "page-presence", payload: { pageId: string; count: number }): void;
    };
    room.emit("page-presence", { pageId, count });
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const pageRoomChannel = new PageRoomChannel();
