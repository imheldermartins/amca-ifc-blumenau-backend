import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@core/socket/realtime-contract-v1";
import type { CubsSocket, CubsSocketServer } from "@core/socket/socket-types";

export type ClientEventName = keyof ClientToServerEvents;
export type ServerEventName = keyof ServerToClientEvents;

/** Uma responsabilidade realtime com ownership explicito de seus eventos. */
export interface RealtimeChannel {
  readonly id: string;
  readonly clientEvents: readonly ClientEventName[];
  readonly serverEvents: readonly ServerEventName[];

  attach(io: CubsSocketServer): void;
  register(socket: CubsSocket): void;
}
