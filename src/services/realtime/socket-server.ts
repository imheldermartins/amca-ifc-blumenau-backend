import type { Server as NodeHttpServer } from "node:http";
import { Server } from "socket.io";
import { createAdapter } from '@socket.io/redis-streams-adapter';
import { clusterRedis } from '@/services/cluster/cluster-redis';
import jwtService from "@/services/auth/jwt-service";
import { corsConfig } from "@/services/http/cors.config";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@/services/realtime/contracts/realtime-contract-v1";
import { realtimeChannelRegistry } from "@/services/realtime/realtime-composition";
import type { CubsSocket, CubsSocketServer, SocketData, InterServerEvents } from "@/services/realtime/types/socket.types";
import type { AccessTokenVerifier, SocketChannelRegistry } from "@/services/realtime/types/socket-server.types";

export type { CubsSocket, CubsSocketServer, SocketData } from "@/services/realtime/types/socket.types";
export type {
  ClientToServerEvents,
  EchoReply,
  RealtimeClientToServerEvents,
  RealtimeServerToClientEvents,
  ServerToClientEvents,
} from "@/services/realtime/contracts/realtime-contract-v1";

/**
 * Adaptador Socket.IO: cria o servidor, autentica o handshake e entrega cada
 * conexao ao registry. Regras de pagina e eventos vivem nos channels.
 */
export class SocketServer {
  private io: CubsSocketServer | null = null;

  constructor(
    private readonly registry: SocketChannelRegistry = realtimeChannelRegistry,
    private readonly tokens: AccessTokenVerifier = jwtService,
  ) {}

  attach(httpServer: NodeHttpServer): CubsSocketServer {
    this.io = new Server<
      ClientToServerEvents,
      ServerToClientEvents,
      InterServerEvents,
      SocketData
    >(httpServer, { cors: corsConfig });

    const redis = clusterRedis();
    if (redis) {
      // Stream/subscription clients must wait through a failover. The HTTP rate
      // store uses the separate fail-fast client, so requests cannot hang here.
      const transport = redis.duplicate({ enableOfflineQueue: true, maxRetriesPerRequest: null, commandTimeout: 60000 });
      transport.on('error', () => console.error('[cubs:cluster] Realtime coordination reconnecting'));
      this.io.adapter(createAdapter(transport, { streamName: 'cubs:socket.io', channelPrefix: 'cubs:socket.io' }));
      httpServer.once('close', () => transport.disconnect());
    }

    this.io.use((socket, next) => {
      const token: unknown = socket.handshake.auth?.token;
      if (typeof token !== "string" || token.length === 0) {
        next(new Error("Não autorizado"));
        return;
      }

      try {
        const { sub } = this.tokens.verifyAccessToken(token);
        if (typeof sub !== "string" || sub.length === 0) {
          throw new Error("JWT sem subject");
        }
        socket.data.userId = sub;
        next();
      } catch {
        next(new Error("Não autorizado"));
      }
    });

    this.registry.attach(this.io);
    this.io.on("connection", (socket) => this.registry.register(socket));
    return this.io;
  }
}

export default new SocketServer();
