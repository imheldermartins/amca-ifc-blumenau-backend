import type { ServerToClientEvents } from "@/services/realtime/contracts/realtime-contract-v1";
import type { CubsSocketServer } from "@/services/realtime/types/socket.types";

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

export type PageEventDelivery = (
  io: CubsSocketServer,
  event: PageEditEventName,
  payload: Parameters<ServerToClientEvents[PageEditEventName]>[0],
) => void;
