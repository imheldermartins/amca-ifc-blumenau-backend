import type { Server as NodeHttpServer } from "node:http";
import { Server } from "socket.io";
import jwtService from "@core/auth/jwt-service";
import { corsConfig } from "@core/http/cors.config";

/**
 * Contrato de eventos com o frontend (espelhado em
 * cubs-frontend/src/services/SocketService.ts). Ao criar um evento novo,
 * atualize os DOIS lados.
 */
export interface EchoReply {
  message: string;
  userId: string;
  at: string;
}

export interface ServerToClientEvents {
  "presence:count": (count: number) => void;
  "echo:reply": (payload: EchoReply) => void;
}

export interface ClientToServerEvents {
  "echo:send": (message: string) => void;
}

interface SocketData {
  userId: string;
}

type CubsSocketServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

/**
 * Camada socket.io do Cub's: pega carona no MESMO http.Server/porta do
 * express (attach é chamado dentro de HttpServer.start()).
 *
 * O handshake exige um access token válido — o mesmo JWT das rotas HTTP:
 * o client conecta com `io(url, { auth: { token } })` e o id do usuário
 * fica disponível em `socket.data.userId` para qualquer handler.
 *
 * Eventos atuais (demonstração do canal):
 *  - "presence:count" (server -> todos): total de conexões ativas.
 *  - "echo:send" (client -> server) / "echo:reply" (server -> client):
 *    eco da mensagem, carimbado com userId e timestamp.
 */
class SocketServer {
  private io: CubsSocketServer | null = null;

  public attach(httpServer: NodeHttpServer): void {
    this.io = new Server(httpServer, { cors: corsConfig });

    this.io.use((socket, next) => {
      const token: unknown = socket.handshake.auth?.token;

      if (typeof token !== "string" || token.length === 0) {
        return next(new Error("Não autorizado"));
      }

      try {
        socket.data.userId = jwtService.verifyAccessToken(token).sub;
        next();
      } catch {
        next(new Error("Não autorizado"));
      }
    });

    this.io.on("connection", (socket) => {
      this.broadcastPresence();

      socket.on("echo:send", (message) => {
        socket.emit("echo:reply", {
          message: String(message),
          userId: socket.data.userId,
          at: new Date().toISOString(),
        });
      });

      socket.on("disconnect", () => this.broadcastPresence());
    });
  }

  private broadcastPresence(): void {
    if (!this.io) return;
    this.io.emit("presence:count", this.io.engine.clientsCount);
  }
}

// Singleton: o HttpServer importa e anexa direto, sem conhecer socket.io.
export default new SocketServer();
