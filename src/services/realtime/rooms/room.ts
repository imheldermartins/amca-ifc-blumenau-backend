import type { CubsSocket } from "@/services/realtime/types/socket.types";

/** Value object para nomes de sala e membership do Socket.IO. */
export abstract class Room<Identifier extends string = string> {
  protected constructor(private readonly prefix: string) {}

  public name(identifier: Identifier): string {
    return `${this.prefix}${identifier}`;
  }

  public identifierFrom(roomName: string): Identifier | null {
    if (!roomName.startsWith(this.prefix)) return null;
    const identifier = roomName.slice(this.prefix.length);
    return identifier.length > 0 ? identifier as Identifier : null;
  }

  public contains(socket: CubsSocket, identifier: Identifier): boolean {
    return socket.rooms.has(this.name(identifier));
  }
}
