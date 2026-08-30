import { createServer, type Server as NodeHttpServer } from "node:http";
import { io as createClient, type Socket as ClientSocket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type {
  CellUpdatedPayload,
  ClientToServerEvents,
  ServerToClientEvents,
} from "@core/socket/realtime-contract-v1";
import { PageEditChannel } from "@core/socket/page-edit-channel";
import { PageInteractionChannel } from "@core/socket/page-interaction-channel";
import { PageRealtimePublisher } from "@core/socket/page-realtime-publisher";
import { PageRoomChannel } from "@core/socket/page-room-channel";
import { RealtimeChannelRegistry } from "@core/socket/realtime-channel-registry";
import { RealtimeEventFactory } from "@core/socket/realtime-event-factory";
import { SocketServer } from "@core/socket/socket-server";
import type { CubsSocketServer } from "@core/socket/socket-types";
import { SystemChannel } from "@core/socket/system-channel";

// SocketServer oferece verifier injetável, mas o módulo mantém o singleton JWT
// como default de produção. O teste não deve depender das envs reais do host.
vi.mock("@core/auth/jwt-service", () => ({
  default: { verifyAccessToken: () => ({ sub: "unused" }) },
}));
vi.mock("@core/http/cors.config", () => ({
  corsConfig: { origin: true, credentials: true },
}));

const PAGE_ID = "01KXDN4B182DJGAKPX0940H54N";
const OTHER_PAGE_ID = "01KXDN4B182DJGAKPX0940H55A";
const ROW_ID = "01KXDN4B7A7MYYCTQS1K452QKW";
const COLUMN_ID = "01KXDN4B3X8J9NXGSTMK8PRFMF";
const OWNER_ID = "01KXDN4AXN6QJBTZTCWP1JWVW4";
const COLLABORATOR_ID = "01KXDN4AYKMRW4AJQBT9XS6CYT";
const STRANGER_ID = "01KXDN4AZDDTZV48VQ9VQ0W3CT";
const UPDATED_AT = "2026-08-15T20:00:00.000Z";

type TestClient = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

let httpServer: NodeHttpServer;
let ioServer: CubsSocketServer;
let url: string;
let pageEdit: PageEditChannel;
let publisher: PageRealtimePublisher;
const clients: TestClient[] = [];

beforeAll(async () => {
  pageEdit = new PageEditChannel();
  const access = {
    canAccessPage: async (userId: string, pageId: string) =>
      (pageId === PAGE_ID && (userId === OWNER_ID || userId === COLLABORATOR_ID)) ||
      (pageId === OTHER_PAGE_ID && userId === STRANGER_ID),
  };
  const registry = new RealtimeChannelRegistry([
    new SystemChannel(() => new Date(UPDATED_AT)),
    new PageRoomChannel(access),
    new PageInteractionChannel(),
    pageEdit,
  ]);
  const usersByToken = new Map([
    ["owner-token", OWNER_ID],
    ["collaborator-token", COLLABORATOR_ID],
    ["stranger-token", STRANGER_ID],
  ]);
  const socketServer = new SocketServer(registry, {
    verifyAccessToken(token) {
      const sub = usersByToken.get(token);
      if (!sub) throw new Error("token inválido");
      return { sub };
    },
  });

  httpServer = createServer();
  ioServer = socketServer.attach(httpServer);
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address();
  if (!address || typeof address === "string") throw new Error("Porta efêmera indisponível");
  url = `http://127.0.0.1:${address.port}`;

  publisher = new PageRealtimePublisher(
    pageEdit,
    { getParentId: async (rowId) => rowId === ROW_ID ? PAGE_ID : null },
    new RealtimeEventFactory(() => new Date(UPDATED_AT)),
  );
});

afterAll(async () => {
  for (const client of clients) client.disconnect();
  await new Promise<void>((resolve) => ioServer.close(() => resolve()));
  if (httpServer.listening) {
    await new Promise<void>((resolve, reject) => {
      httpServer.close((error) => error ? reject(error) : resolve());
    });
  }
});

function onceEvent<T>(socket: TestClient, event: string, timeoutMs = 2_000): Promise<T> {
  const raw = socket as unknown as {
    once(name: string, handler: (payload: unknown) => void): void;
    off(name: string, handler: (payload: unknown) => void): void;
  };

  return new Promise<T>((resolve, reject) => {
    const handler = (payload: unknown) => {
      clearTimeout(timer);
      resolve(payload as T);
    };
    const timer = setTimeout(() => {
      raw.off(event, handler);
      reject(new Error(`Timeout aguardando ${event}`));
    }, timeoutMs);
    raw.once(event, handler);
  });
}

async function connect(token: string): Promise<TestClient> {
  const socket = createClient(url, {
    auth: { token },
    autoConnect: false,
    reconnection: false,
    transports: ["websocket"],
  }) as TestClient;
  clients.push(socket);
  const connected = onceEvent<void>(socket, "connect");
  socket.connect();
  await connected;
  return socket;
}

async function join(socket: TestClient, pageId: string): Promise<{ pageId: string }> {
  const joined = onceEvent<{ pageId: string }>(socket, "joined-page-database");
  socket.emit("join-page-database", { pageId });
  return joined;
}

async function nextTurn(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 25));
}

describe("SocketServer + channels com clientes reais", () => {
  it("isola rooms, inclui o autor e exige novo join após reconectar", async () => {
    const owner = await connect("owner-token");
    const collaborator = await connect("collaborator-token");
    const stranger = await connect("stranger-token");

    await expect(join(owner, PAGE_ID)).resolves.toEqual({ pageId: PAGE_ID });
    await expect(join(collaborator, PAGE_ID)).resolves.toEqual({ pageId: PAGE_ID });

    const denied = onceEvent<{ pageId: string }>(stranger, "page-database-denied");
    stranger.emit("join-page-database", { pageId: PAGE_ID });
    await expect(denied).resolves.toEqual({ pageId: PAGE_ID });
    await expect(join(stranger, OTHER_PAGE_ID)).resolves.toEqual({ pageId: OTHER_PAGE_ID });

    const leakedToOtherPage: CellUpdatedPayload[] = [];
    const leakedDomainEvents: string[] = [];
    stranger.on("cell-updated", (payload) => leakedToOtherPage.push(payload));
    for (const event of [
      "row-updated",
      "page-updated",
      "column-updated",
      "view-updated",
    ] as const) {
      stranger.on(event, () => leakedDomainEvents.push(event));
    }
    const ownerEcho = onceEvent<CellUpdatedPayload>(owner, "cell-updated");
    const collaboratorUpdate = onceEvent<CellUpdatedPayload>(collaborator, "cell-updated");

    // Representa uma escrita HTTP já confirmada: somente então o publisher é
    // chamado, e ambos os membros autorizados recebem o mesmo fato.
    await publisher.cellUpdated({
      rowId: ROW_ID,
      columnId: COLUMN_ID,
      value: false,
      originUserId: OWNER_ID,
    });

    const expected = {
      pageId: PAGE_ID,
      rowId: ROW_ID,
      columnId: COLUMN_ID,
      value: false,
      updatedAt: UPDATED_AT,
      originUserId: OWNER_ID,
    };
    await expect(ownerEcho).resolves.toEqual(expected);
    await expect(collaboratorUpdate).resolves.toEqual(expected);

    const snapshot = {
      "01KXDN4B9A7MYYCTQS1K452QAA": { view: "table", name: "Principal" },
      "01KXDN4B9A7MYYCTQS1K452QAB": { view: "board", name: "Inativa" },
    };
    const ownerPageTitle = onceEvent(owner, "page-updated");
    const collaboratorPageTitle = onceEvent(collaborator, "page-updated");
    const ownerSnapshot = onceEvent(owner, "view-updated");
    const collaboratorSnapshot = onceEvent(collaborator, "view-updated");
    await publisher.pageChanged({
      pageId: PAGE_ID,
      title: "Título da página",
      data: snapshot,
      originUserId: OWNER_ID,
    });
    await expect(ownerPageTitle).resolves.toMatchObject({
      pageId: PAGE_ID,
      title: "Título da página",
    });
    await expect(collaboratorPageTitle).resolves.toMatchObject({
      pageId: PAGE_ID,
      title: "Título da página",
    });
    await expect(ownerSnapshot).resolves.toMatchObject({ pageId: PAGE_ID, data: snapshot });
    await expect(collaboratorSnapshot).resolves.toMatchObject({
      pageId: PAGE_ID,
      data: snapshot,
    });

    const ownerRowTitle = onceEvent(owner, "row-updated");
    const collaboratorRowTitle = onceEvent(collaborator, "row-updated");
    await publisher.pageChanged({
      pageId: ROW_ID,
      title: "Título da linha",
      originUserId: COLLABORATOR_ID,
    });
    await expect(ownerRowTitle).resolves.toMatchObject({
      pageId: PAGE_ID,
      rowId: ROW_ID,
      title: "Título da linha",
    });
    await expect(collaboratorRowTitle).resolves.toMatchObject({
      pageId: PAGE_ID,
      rowId: ROW_ID,
      title: "Título da linha",
    });

    const column = {
      id: COLUMN_ID,
      parent_id: PAGE_ID,
      name: "Documento",
      type: "text",
      data: { mask: "cpf", options: [], format: "currency", currency: "BRL" },
    };
    const ownerColumn = onceEvent(owner, "column-updated");
    const collaboratorColumn = onceEvent(collaborator, "column-updated");
    await publisher.columnUpdated({
      pageId: PAGE_ID,
      columnId: COLUMN_ID,
      column,
      originUserId: OWNER_ID,
    });
    await expect(ownerColumn).resolves.toMatchObject({ pageId: PAGE_ID, column });
    await expect(collaboratorColumn).resolves.toMatchObject({ pageId: PAGE_ID, column });

    await nextTurn();
    expect(leakedToOtherPage).toEqual([]);
    expect(leakedDomainEvents).toEqual([]);

    owner.disconnect();
    const reconnected = onceEvent<void>(owner, "connect");
    owner.connect();
    await reconnected;

    const receivedBeforeRejoin: CellUpdatedPayload[] = [];
    owner.on("cell-updated", (payload) => receivedBeforeRejoin.push(payload));
    const collaboratorWhileOwnerAway = onceEvent<CellUpdatedPayload>(
      collaborator,
      "cell-updated",
    );
    await publisher.cellUpdated({
      rowId: ROW_ID,
      columnId: COLUMN_ID,
      value: 0,
      originUserId: COLLABORATOR_ID,
    });
    await collaboratorWhileOwnerAway;
    await nextTurn();
    expect(receivedBeforeRejoin).toEqual([]);

    // O ACK é a fronteira usada pelo frontend para só então fazer o refetch.
    await expect(join(owner, PAGE_ID)).resolves.toEqual({ pageId: PAGE_ID });
    const afterRejoin = onceEvent<CellUpdatedPayload>(owner, "cell-updated");
    await publisher.cellUpdated({
      rowId: ROW_ID,
      columnId: COLUMN_ID,
      value: "depois-do-ack",
      originUserId: COLLABORATOR_ID,
    });
    await expect(afterRejoin).resolves.toMatchObject({
      pageId: PAGE_ID,
      value: "depois-do-ack",
    });
  });
});
