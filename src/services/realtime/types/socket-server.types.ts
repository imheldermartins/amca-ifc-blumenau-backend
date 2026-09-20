import type { CubsSocket, CubsSocketServer } from "@/services/realtime/types/socket.types";

export interface AccessTokenVerifier {
  verifyAccessToken(token: string): { sub: string };
}

export interface SocketChannelRegistry {
  attach(io: CubsSocketServer): void;
  register(socket: CubsSocket): void;
}
