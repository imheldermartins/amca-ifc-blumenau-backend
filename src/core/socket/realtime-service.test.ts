import { beforeEach, describe, expect, it, vi } from "vitest";

const access = vi.hoisted(() => ({
  canAccessPage: vi.fn<(userId: string, pageId: string) => Promise<boolean>>(),
}));

vi.mock("@/controllers/page-access-controller", () => ({
  default: access,
}));

import realtimeService, {
  type CellUpdatedPayload,
} from "@core/socket/realtime-service";
import type { CubsSocket, CubsSocketServer } from "@core/socket/socket-server";

type Handler = (payload?: unknown) => unknown;

const PAGE_ID = "01KXDN4B182DJGAKPX0940H54N";
const ROW_ID = "01KXDN4B7A7MYYCTQS1K452QKW";
const COLUMN_ID = "01KXDN4B3X8J9NXGSTMK8PRFMF";
const OWNER_ID = "01KXDN4AXN6QJBTZTCWP1JWVW4";
const COLLABORATOR_ID = "01KXDN4AYKMRW4AJQBT9XS6CYT";
const STRANGER_ID = "01KXDN4AZDDTZV48VQ9VQ0W3CT";

/**
 * Duplo pequeno do adapter em memória do Socket.IO. A intenção aqui não é
 * retestar a biblioteca: é provar o nosso contrato de sala ponta a ponta —
 * join autorizado, mesma audiência para dono/colaborador e negação para
 * quem não tem acesso.
 */
class FakeIo {
  readonly socketsById = new Map<string, FakeSocket>();
  readonly sockets = {
    adapter: {
      rooms: new Map<string, Set<string>>(),
    },
  };

  add(socket: FakeSocket): void {
    this.socketsById.set(socket.id, socket);
  }

  to(room: string) {
    return {
      emit: (event: string, payload: unknown) => {
        for (const socketId of this.sockets.adapter.rooms.get(room) ?? []) {
          this.socketsById.get(socketId)?.receive(event, payload);
        }
      },
    };
  }
}

class FakeSocket {
  readonly rooms: Set<string>;
  readonly data: { userId: string };
  readonly received: Array<{ event: string; payload: unknown }> = [];
  private readonly handlers = new Map<string, Handler[]>();

  constructor(
    readonly id: string,
    userId: string,
    private readonly io: FakeIo,
  ) {
    this.data = { userId };
    this.rooms = new Set([id]);
    io.add(this);
  }

  on(event: string, handler: Handler): this {
    const handlers = this.handlers.get(event) ?? [];
    handlers.push(handler);
    this.handlers.set(event, handlers);
    return this;
  }

  emit(event: string, payload: unknown): this {
    this.receive(event, payload);
    return this;
  }

  to(room: string) {
    const socket = this;
    return {
      get volatile() {
        return this;
      },
      emit(event: string, payload: unknown) {
        for (const socketId of socket.io.sockets.adapter.rooms.get(room) ?? []) {
          if (socketId !== socket.id) socket.io.socketsById.get(socketId)?.receive(event, payload);
        }
      },
    };
  }

  async join(room: string): Promise<void> {
    this.rooms.add(room);
    const members = this.io.sockets.adapter.rooms.get(room) ?? new Set<string>();
    members.add(this.id);
    this.io.sockets.adapter.rooms.set(room, members);
  }

  async leave(room: string): Promise<void> {
    this.rooms.delete(room);
    const members = this.io.sockets.adapter.rooms.get(room);
    members?.delete(this.id);
    if (members?.size === 0) this.io.sockets.adapter.rooms.delete(room);
  }

  receive(event: string, payload: unknown): void {
    this.received.push({ event, payload });
  }

  async trigger(event: string, payload?: unknown): Promise<void> {
    for (const handler of this.handlers.get(event) ?? []) await handler(payload);
  }

  clear(): void {
    this.received.length = 0;
  }

  payloads(event: string): unknown[] {
    return this.received
      .filter((received) => received.event === event)
      .map((received) => received.payload);
  }
}

function register(io: FakeIo, id: string, userId: string): FakeSocket {
  const socket = new FakeSocket(id, userId, io);
  realtimeService.registerHandlers(socket as unknown as CubsSocket);
  return socket;
}

describe("RealtimeService: audiência owner/collaborator", () => {
  beforeEach(() => {
    access.canAccessPage.mockReset();
  });

  it("faz broadcast simétrico entre dono e colaborador e exclui quem não tem acesso", async () => {
    const io = new FakeIo();
    realtimeService.initialize(io as unknown as CubsSocketServer);

    access.canAccessPage.mockImplementation(async (userId, pageId) =>
      pageId === PAGE_ID && (userId === OWNER_ID || userId === COLLABORATOR_ID),
    );

    const owner = register(io, "socket-owner", OWNER_ID);
    const collaborator = register(io, "socket-collaborator", COLLABORATOR_ID);
    const stranger = register(io, "socket-stranger", STRANGER_ID);

    await owner.trigger("join-page-database", { pageId: PAGE_ID });
    await collaborator.trigger("join-page-database", { pageId: PAGE_ID });
    await stranger.trigger("join-page-database", { pageId: PAGE_ID });

    expect(owner.payloads("joined-page-database")).toEqual([{ pageId: PAGE_ID }]);
    expect(collaborator.payloads("joined-page-database")).toEqual([{ pageId: PAGE_ID }]);
    expect(stranger.payloads("page-database-denied")).toEqual([{ pageId: PAGE_ID }]);

    owner.clear();
    collaborator.clear();
    stranger.clear();

    const ownerUpdate: CellUpdatedPayload = {
      pageId: PAGE_ID,
      rowId: ROW_ID,
      columnId: COLUMN_ID,
      value: "owner-value",
      updatedAt: "2026-08-15T20:00:00.000Z",
      originUserId: OWNER_ID,
    };
    realtimeService.emitCellUpdated(ownerUpdate);

    // owner -> collaborator (e eco autoritativo para o próprio owner)
    expect(owner.payloads("cell-updated")).toEqual([ownerUpdate]);
    expect(collaborator.payloads("cell-updated")).toEqual([ownerUpdate]);
    expect(stranger.payloads("cell-updated")).toEqual([]);

    owner.clear();
    collaborator.clear();

    const collaboratorUpdate: CellUpdatedPayload = {
      ...ownerUpdate,
      value: "collaborator-value",
      updatedAt: "2026-08-15T20:00:01.000Z",
      originUserId: COLLABORATOR_ID,
    };
    realtimeService.emitCellUpdated(collaboratorUpdate);

    // collaborator -> owner: exatamente a mesma audiência, sem ramo por role.
    expect(owner.payloads("cell-updated")).toEqual([collaboratorUpdate]);
    expect(collaborator.payloads("cell-updated")).toEqual([collaboratorUpdate]);
    expect(stranger.payloads("cell-updated")).toEqual([]);
  });

  it("repassa preview volatile somente aos outros membros da sala autorizada", async () => {
    const io = new FakeIo();
    realtimeService.initialize(io as unknown as CubsSocketServer);
    access.canAccessPage.mockImplementation(async (userId, pageId) =>
      pageId === PAGE_ID && (userId === OWNER_ID || userId === COLLABORATOR_ID),
    );

    const owner = register(io, "socket-owner", OWNER_ID);
    const collaborator = register(io, "socket-collaborator", COLLABORATOR_ID);
    const stranger = register(io, "socket-stranger", STRANGER_ID);

    await owner.trigger("join-page-database", { pageId: PAGE_ID });
    await collaborator.trigger("join-page-database", { pageId: PAGE_ID });
    await stranger.trigger("join-page-database", { pageId: PAGE_ID });
    owner.clear();
    collaborator.clear();
    stranger.clear();

    const preview = {
      pageId: PAGE_ID,
      viewId: "01KXDN4B9A7MYYCTQS1K452QAA",
      columnId: COLUMN_ID,
      width: 384,
    };
    await owner.trigger("resize-column", { ...preview, originUserId: STRANGER_ID });

    expect(owner.payloads("column-resizing")).toEqual([]);
    expect(collaborator.payloads("column-resizing")).toEqual([
      { ...preview, originUserId: OWNER_ID },
    ]);
    expect(stranger.payloads("column-resizing")).toEqual([]);

    await stranger.trigger("resize-column", preview);
    await owner.trigger("resize-column", { ...preview, width: Number.NaN });
    expect(collaborator.payloads("column-resizing")).toHaveLength(1);
  });
});
