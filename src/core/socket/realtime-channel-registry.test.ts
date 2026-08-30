import { describe, expect, it, vi } from "vitest";
import type { RealtimeChannel } from "@core/socket/realtime-channel";
import { RealtimeChannelRegistry } from "@core/socket/realtime-channel-registry";
import type { CubsSocket, CubsSocketServer } from "@core/socket/socket-types";

const inventory = {
  clientEvents: ["echo:send"] as const,
  serverEvents: ["echo:reply"] as const,
};

function channel(id: string): RealtimeChannel {
  return {
    id,
    clientEvents: ["echo:send"],
    serverEvents: ["echo:reply"],
    attach: vi.fn(),
    register: vi.fn(),
  };
}

describe("RealtimeChannelRegistry", () => {
  it("rejeita ids duplicados no boot", () => {
    expect(() => new RealtimeChannelRegistry([channel("same"), channel("same")], inventory))
      .toThrow("Realtime channel id duplicado: same");
  });

  it("rejeita ownership duplicado de eventos client e server", () => {
    const first = channel("first");
    const duplicateClient: RealtimeChannel = {
      ...channel("second"),
      serverEvents: [],
    };
    expect(() => new RealtimeChannelRegistry([first, duplicateClient], inventory))
      .toThrow("Evento realtime client duplicado: echo:send (first, second)");

    const duplicateServer: RealtimeChannel = {
      ...channel("second"),
      clientEvents: [],
    };
    expect(() => new RealtimeChannelRegistry([first, duplicateServer], inventory))
      .toThrow("Evento realtime server duplicado: echo:reply (first, second)");
  });

  it("rejeita protocolo incompleto", () => {
    const incomplete: RealtimeChannel = {
      ...channel("incomplete"),
      serverEvents: [],
    };
    expect(() => new RealtimeChannelRegistry([incomplete], inventory))
      .toThrow("Inventario realtime server invalido (faltando: echo:reply)");
  });

  it("anexa todos os channels e registra cada socket uma unica vez", () => {
    const only = channel("only");
    const registry = new RealtimeChannelRegistry([only], inventory);
    const io = {} as CubsSocketServer;
    const socket = {} as CubsSocket;

    registry.attach(io);
    registry.register(socket);
    registry.register(socket);

    expect(only.attach).toHaveBeenCalledOnce();
    expect(only.attach).toHaveBeenCalledWith(io);
    expect(only.register).toHaveBeenCalledOnce();
    expect(only.register).toHaveBeenCalledWith(socket);
    expect(registry.list()).toEqual([only]);
  });
});
