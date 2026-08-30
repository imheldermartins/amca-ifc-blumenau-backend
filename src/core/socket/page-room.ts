export const PAGE_ROOM_PREFIX = "page-database:";

export function roomForPage(pageId: string): string {
  return `${PAGE_ROOM_PREFIX}${pageId}`;
}

export function pageIdFromRoom(room: string): string | null {
  if (!room.startsWith(PAGE_ROOM_PREFIX)) return null;
  const pageId = room.slice(PAGE_ROOM_PREFIX.length);
  return pageId.length > 0 ? pageId : null;
}

/** Aceita somente o wire shape `{ pageId }`. */
export function readPageId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const pageId = (payload as { pageId?: unknown }).pageId;
  return typeof pageId === "string" && pageId.length > 0 ? pageId : null;
}
