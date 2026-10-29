import type { Server, Socket } from "socket.io";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@/services/realtime/contracts/realtime-contract-v1";

export interface SocketData {
  userId: string;
}

export interface InterServerEvents {
  'campus-page-event': (
    event: import('@/services/realtime/types/page-edit.types').PageEditEventName,
    payload: Parameters<ServerToClientEvents[import('@/services/realtime/types/page-edit.types').PageEditEventName]>[0],
  ) => void;
}

export type CubsSocketServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

export type CubsSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;
