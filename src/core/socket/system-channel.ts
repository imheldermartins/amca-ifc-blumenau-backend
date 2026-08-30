import type { RealtimeChannel } from "@core/socket/realtime-channel";
import type { CubsSocket, CubsSocketServer } from "@core/socket/socket-types";

/** Compatibilidade global v1: contagem de conexoes e echo de diagnostico. */
export class SystemChannel implements RealtimeChannel {
  readonly id = "system";
  readonly clientEvents = ["echo:send"] as const;
  readonly serverEvents = ["presence:count", "echo:reply"] as const;

  private io: CubsSocketServer | null = null;

  constructor(private readonly now: () => Date = () => new Date()) {}

  attach(io: CubsSocketServer): void {
    this.io = io;
  }

  register(socket: CubsSocket): void {
    this.broadcastPresence();

    socket.on("echo:send", (message) => {
      socket.emit("echo:reply", {
        message: String(message),
        userId: socket.data.userId,
        at: this.now().toISOString(),
      });
    });

    socket.on("disconnect", () => this.broadcastPresence());
  }

  private broadcastPresence(): void {
    if (!this.io) return;
    this.io.emit("presence:count", this.io.engine.clientsCount);
  }
}

export const systemChannel = new SystemChannel();
