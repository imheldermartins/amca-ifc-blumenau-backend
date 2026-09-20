import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@/services/realtime/contracts/realtime-contract-v1";
import type { CubsSocket, CubsSocketServer } from "@/services/realtime/types/socket.types";

export type ClientEventName = keyof ClientToServerEvents;
export type ServerEventName = keyof ServerToClientEvents;

export interface RealtimeChannel {
  readonly id: string;
  readonly clientEvents: readonly ClientEventName[];
  readonly serverEvents: readonly ServerEventName[];
  attach(io: CubsSocketServer): void;
  register(socket: CubsSocket): void;
}
