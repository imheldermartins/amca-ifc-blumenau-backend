import { describe, expect, it, vi } from "vitest";
import { PageEditChannel } from "@core/socket/page-edit-channel";
import { PageInteractionChannel } from "@core/socket/page-interaction-channel";
import { roomForPage } from "@core/socket/page-room";
import { PageRoomChannel } from "@core/socket/page-room-channel";
import { RealtimeChannelRegistry } from "@core/socket/realtime-channel-registry";
import type { CubsSocket, CubsSocketServer } from "@core/socket/socket-types";
import { SystemChannel } from "@core/socket/system-channel";

type Handler = (payload?: unknown) => unknown;

const PAGE_ID = "01KXDN4B182DJGAKPX0940H54N";
const OTHER_PAGE_ID = "01KXDN4B182DJGAKPX0940H55A";
const ROW_ID = "01KXDN4B7A7MYYCTQS1K452QKW";
const COLUMN_ID = "01KXDN4B3X8J9NXGSTMK8PRFMF";
const OWNER_ID = "01KXDN4AXN6QJBTZTCWP1JWVW4";
const COLLABORATOR_ID = "01KXDN4AYKMRW4AJQBT9XS6CYT";
const STRANGER_ID = "01KXDN4AZDDTZV48VQ9VQ0W3CT";
const UPDATED_AT = "2026-08-15T20:00:00.000Z";

class FakeIo {
  readonly socketsById = new Map<string, FakeSocket>();
  readonly sockets = { adapter: { rooms: new Map<string, Set<string>>() } };
  readonly engine: { readonly clientsCount: number };

  constructor() {
    this.engine = Object.defineProperty({}, "clientsCount", {
      get: () => this.socketsById.size,
    }) as { readonly clientsCount: number };
  }

  add(socket: FakeSocket): void {
    this.socketsById.set(socket.id, socket);
  }

  emit(event: string, payload: unknown): void {
    for (const socket of this.socketsById.values()) socket.receive(event, payload);
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
          if (socketId !== socket.id) {
            socket.io.socketsById.get(socketId)?.receive(event, payload);
          }
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

  async trigger(event: string, payload?: unknown): Promise<void> {
    for (const handler of this.handlers.get(event) ?? []) await handler(payload);
  }

  removeFromRooms(): void {
    for (const room of [...this.rooms]) {
      if (room !== this.id) void this.leave(room);
    }
  }

  receive(event: string, payload: unknown): void {
    this.received.push({ event, payload });
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

function setup() {
  const io = new FakeIo();
  const deferred: Array<() => void> = [];
  const access = {
    canAccessPage: vi.fn(async (userId: string, pageId: string) =>
      pageId === PAGE_ID && (userId === OWNER_ID || userId === COLLABORATOR_ID),
    ),
  };
  const pageRoom = new PageRoomChannel(access, (task) => deferred.push(task));
  const pageInteraction = new PageInteractionChannel();
  const pageEdit = new PageEditChannel();
  const system = new SystemChannel(() => new Date(UPDATED_AT));
  const registry = new RealtimeChannelRegistry([system, pageRoom, pageInteraction, pageEdit]);
  registry.attach(io as unknown as CubsSocketServer);

  const owner = new FakeSocket("socket-owner", OWNER_ID, io);
  const collaborator = new FakeSocket("socket-collaborator", COLLABORATOR_ID, io);
  const stranger = new FakeSocket("socket-stranger", STRANGER_ID, io);
  for (const socket of [owner, collaborator, stranger]) {
    registry.register(socket as unknown as CubsSocket);
  }
  owner.clear();
  collaborator.clear();
  stranger.clear();

  return { io, deferred, access, pageRoom, pageEdit, owner, collaborator, stranger };
}

describe("channels realtime v1", () => {
  it("autoriza owner/collaborator, nega estranho e mantem presenca no join/leave", async () => {
    const { owner, collaborator, stranger } = setup();

    await owner.trigger("join-page-database", { pageId: PAGE_ID });
    expect(owner.payloads("joined-page-database")).toEqual([{ pageId: PAGE_ID }]);
    expect(owner.payloads("page-presence")).toEqual([{ pageId: PAGE_ID, count: 1 }]);

    owner.clear();
    await collaborator.trigger("join-page-database", { pageId: PAGE_ID });
    await stranger.trigger("join-page-database", { pageId: PAGE_ID });
    expect(owner.payloads("page-presence")).toEqual([{ pageId: PAGE_ID, count: 2 }]);
    expect(collaborator.payloads("joined-page-database")).toEqual([{ pageId: PAGE_ID }]);
    expect(stranger.payloads("page-database-denied")).toEqual([{ pageId: PAGE_ID }]);

    owner.clear();
    await collaborator.trigger("leave-page-database", { pageId: PAGE_ID });
    expect(owner.payloads("page-presence")).toEqual([{ pageId: PAGE_ID, count: 1 }]);
  });

  it("faz eco autoritativo dos eventos duraveis apenas para a room correta", async () => {
    const { pageEdit, owner, collaborator, stranger } = setup();
    await owner.trigger("join-page-database", { pageId: PAGE_ID });
    await collaborator.trigger("join-page-database", { pageId: PAGE_ID });
    owner.clear();
    collaborator.clear();

    const base = { pageId: PAGE_ID, updatedAt: UPDATED_AT, originUserId: OWNER_ID };
    pageEdit.emitCellUpdated({ ...base, rowId: ROW_ID, columnId: COLUMN_ID, value: false });
    pageEdit.emitPageUpdated({ ...base, title: "Nova pagina" });
    pageEdit.emitColumnCreated({ ...base, columnId: COLUMN_ID });
    pageEdit.emitColumnDeleted({ ...base, columnId: COLUMN_ID });
    pageEdit.emitRowDeleted({ ...base, rowId: ROW_ID });

    for (const socket of [owner, collaborator]) {
      expect(socket.payloads("cell-updated")).toEqual([
        { ...base, rowId: ROW_ID, columnId: COLUMN_ID, value: false },
      ]);
      expect(socket.payloads("page-updated")).toEqual([{ ...base, title: "Nova pagina" }]);
      expect(socket.payloads("column-created")).toHaveLength(1);
      expect(socket.payloads("column-deleted")).toHaveLength(1);
      expect(socket.payloads("row-deleted")).toHaveLength(1);
    }
    expect(stranger.payloads("cell-updated")).toEqual([]);

    pageEdit.emitRowCreated({ ...base, pageId: OTHER_PAGE_ID, rowId: ROW_ID });
    expect(owner.payloads("row-created")).toEqual([]);
  });

  it("repassa resize valido somente aos outros membros e ignora frames indevidos", async () => {
    const { owner, collaborator, stranger } = setup();
    await owner.trigger("join-page-database", { pageId: PAGE_ID });
    await collaborator.trigger("join-page-database", { pageId: PAGE_ID });
    owner.clear();
    collaborator.clear();

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

    await stranger.trigger("resize-column", preview);
    await owner.trigger("resize-column", { ...preview, width: Number.NaN });
    await owner.trigger("resize-column", { ...preview, width: 0 });
    expect(collaborator.payloads("column-resizing")).toHaveLength(1);
  });

  it("reconta presenca depois do cleanup automatico no disconnecting", async () => {
    const { deferred, owner, collaborator } = setup();
    await owner.trigger("join-page-database", { pageId: PAGE_ID });
    await collaborator.trigger("join-page-database", { pageId: PAGE_ID });
    owner.clear();

    await collaborator.trigger("disconnecting");
    collaborator.removeFromRooms();
    for (const task of deferred) task();

    expect(owner.payloads("page-presence")).toEqual([{ pageId: PAGE_ID, count: 1 }]);
  });

  it("preserva echo e presence globais no SystemChannel", async () => {
    const { owner } = setup();
    await owner.trigger("echo:send", 42);
    expect(owner.payloads("echo:reply")).toEqual([
      { message: "42", userId: OWNER_ID, at: UPDATED_AT },
    ]);
  });
});
