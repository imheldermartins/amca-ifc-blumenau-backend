import type {
  ColumnResizingPayload,
  ResizeColumnCommand,
} from "@core/socket/realtime-contract-v1";
import type { RealtimeChannel } from "@core/socket/realtime-channel";
import { roomForPage } from "@core/socket/page-room";
import type { CubsSocket, CubsSocketServer } from "@core/socket/socket-types";

export class PageInteractionChannel implements RealtimeChannel {
  readonly id = "page-interaction";
  readonly clientEvents = ["resize-column"] as const;
  readonly serverEvents = ["column-resizing"] as const;

  attach(_io: CubsSocketServer): void {}

  register(socket: CubsSocket): void {
    socket.on("resize-column", (payload) => {
      const preview = readResizeColumn(payload);
      if (!preview) return;

      // O join ja autorizou o socket. Membership em memoria impede publicar
      // frames numa pagina que este socket nao abriu.
      const roomName = roomForPage(preview.pageId);
      if (!socket.rooms.has(roomName)) return;

      const room = socket.to(roomName).volatile as unknown as {
        emit(event: "column-resizing", payload: ColumnResizingPayload): void;
      };
      room.emit("column-resizing", {
        ...preview,
        originUserId: socket.data.userId,
      });
    });
  }
}

/** Valida o frame sem confiar em ids, largura ou autoria do cliente. */
export function readResizeColumn(payload: unknown): ResizeColumnCommand | null {
  if (!payload || typeof payload !== "object") return null;
  const candidate = payload as Record<string, unknown>;
  const pageId = readShortText(candidate.pageId);
  const viewId = readShortText(candidate.viewId);
  const columnId = readShortText(candidate.columnId);
  const width = candidate.width;

  if (!pageId || !viewId || !columnId || typeof width !== "number") return null;
  if (!Number.isFinite(width) || width <= 0) return null;
  return { pageId, viewId, columnId, width };
}

function readShortText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 128 ? value : null;
}

export const pageInteractionChannel = new PageInteractionChannel();
