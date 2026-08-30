import {
  REALTIME_CLIENT_TO_SERVER_EVENT_NAMES,
  REALTIME_SERVER_TO_CLIENT_EVENT_NAMES,
} from "@core/socket/realtime-contract-v1";
import type {
  ClientEventName,
  RealtimeChannel,
  ServerEventName,
} from "@core/socket/realtime-channel";
import type { CubsSocket, CubsSocketServer } from "@core/socket/socket-types";

export interface RealtimeProtocolInventory {
  clientEvents: readonly ClientEventName[];
  serverEvents: readonly ServerEventName[];
}

const V1_INVENTORY: RealtimeProtocolInventory = {
  clientEvents: REALTIME_CLIENT_TO_SERVER_EVENT_NAMES,
  serverEvents: REALTIME_SERVER_TO_CLIENT_EVENT_NAMES,
};

/**
 * Valida o grafo de channels uma vez e registra cada um uma unica vez por
 * conexao. Duplicidade vira erro de boot, nao listener concorrente em runtime.
 */
export class RealtimeChannelRegistry {
  private readonly registeredSockets = new WeakSet<CubsSocket>();

  constructor(
    private readonly channels: readonly RealtimeChannel[],
    inventory: RealtimeProtocolInventory = V1_INVENTORY,
  ) {
    this.validate(inventory);
  }

  attach(io: CubsSocketServer): void {
    for (const channel of this.channels) channel.attach(io);
  }

  register(socket: CubsSocket): void {
    if (this.registeredSockets.has(socket)) return;
    this.registeredSockets.add(socket);
    for (const channel of this.channels) channel.register(socket);
  }

  list(): readonly RealtimeChannel[] {
    return this.channels;
  }

  private validate(inventory: RealtimeProtocolInventory): void {
    const ids = new Set<string>();
    const clientOwners = new Map<ClientEventName, string>();
    const serverOwners = new Map<ServerEventName, string>();

    for (const channel of this.channels) {
      if (!channel.id) throw new Error("Realtime channel sem id");
      if (ids.has(channel.id)) {
        throw new Error(`Realtime channel id duplicado: ${channel.id}`);
      }
      ids.add(channel.id);

      this.claimEvents(channel.id, channel.clientEvents, clientOwners, "client");
      this.claimEvents(channel.id, channel.serverEvents, serverOwners, "server");
    }

    this.assertInventory("client", inventory.clientEvents, clientOwners);
    this.assertInventory("server", inventory.serverEvents, serverOwners);
  }

  private claimEvents<E extends string>(
    channelId: string,
    events: readonly E[],
    owners: Map<E, string>,
    direction: "client" | "server",
  ): void {
    for (const event of events) {
      const owner = owners.get(event);
      if (owner) {
        throw new Error(
          `Evento realtime ${direction} duplicado: ${event} (${owner}, ${channelId})`,
        );
      }
      owners.set(event, channelId);
    }
  }

  private assertInventory<E extends string>(
    direction: "client" | "server",
    expected: readonly E[],
    owners: ReadonlyMap<E, string>,
  ): void {
    const expectedSet = new Set(expected);
    const missing = expected.filter((event) => !owners.has(event));
    const unexpected = [...owners.keys()].filter((event) => !expectedSet.has(event));

    if (missing.length > 0 || unexpected.length > 0) {
      const details = [
        missing.length > 0 ? `faltando: ${missing.join(", ")}` : null,
        unexpected.length > 0 ? `desconhecidos: ${unexpected.join(", ")}` : null,
      ]
        .filter((detail): detail is string => detail !== null)
        .join("; ");
      throw new Error(`Inventario realtime ${direction} invalido (${details})`);
    }
  }
}
