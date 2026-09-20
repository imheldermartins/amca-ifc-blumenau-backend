import { Room } from "@/services/realtime/rooms/room";

export class PageRoom extends Room<string> {
  public constructor() {
    super("page-database:");
  }

  public readIdentifier(payload: unknown): string | null {
    if (!payload || typeof payload !== "object") return null;
    const pageId = (payload as { pageId?: unknown }).pageId;
    return typeof pageId === "string" && pageId.length > 0 ? pageId : null;
  }
}

export const pageRoom = new PageRoom();
