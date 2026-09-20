import type {
  ColumnResizingPayload,
  ResizeColumnCommand,
} from "@/services/realtime/contracts/realtime-contract-v1";
import type { RealtimeChannel } from "@/services/realtime/types/realtime-channel.types";
import { pageRoom, type PageRoom } from "@/services/realtime/rooms/page-room";
import type { CubsSocket, CubsSocketServer } from "@/services/realtime/types/socket.types";
import access from '@db/scoped-access-store';

export class PageInteractionChannel implements RealtimeChannel {
  readonly id = "page-interaction";
  readonly clientEvents = ["resize-column"] as const;
  readonly serverEvents = ["column-resizing"] as const;
  constructor(
    private readonly mayEdit = (pageId: string,userId: string) => access.can('page',pageId,userId,'write','update'),
    private readonly room: PageRoom = pageRoom,
  ) {}

  attach(_io: CubsSocketServer): void {}

  register(socket: CubsSocket): void {
    socket.on("resize-column", async (payload) => {
      const preview = this.readResizeColumn(payload);
      if (!preview) return;

      // O join ja autorizou o socket. Membership em memoria impede publicar
      // frames numa pagina que este socket nao abriu.
      const roomName = this.room.name(preview.pageId);
      if (!this.room.contains(socket, preview.pageId)) return;
      try { if (!await this.mayEdit(preview.pageId,socket.data.userId)) return; } catch { return; }
      if (!this.room.contains(socket, preview.pageId)) return;

      const room = socket.to(roomName).volatile as unknown as {
        emit(event: "column-resizing", payload: ColumnResizingPayload): void;
      };
      room.emit("column-resizing", {
        ...preview,
        originUserId: socket.data.userId,
      });
    });
  }

  /** Valida o frame sem confiar em ids, largura ou autoria do cliente. */
  private readResizeColumn(payload: unknown): ResizeColumnCommand | null {
    if (!payload || typeof payload !== "object") return null;
    const candidate = payload as Record<string, unknown>;
    const pageId = this.readShortText(candidate.pageId);
    const viewId = this.readShortText(candidate.viewId);
    const columnId = this.readShortText(candidate.columnId);
    const width = candidate.width;

    if (!pageId || !viewId || !columnId || typeof width !== "number") return null;
    if (!Number.isFinite(width) || width <= 0) return null;
    return { pageId, viewId, columnId, width };
  }

  private readShortText(value: unknown): string | null {
    return typeof value === "string" && value.length > 0 && value.length <= 128 ? value : null;
  }
}

export const pageInteractionChannel = new PageInteractionChannel();
