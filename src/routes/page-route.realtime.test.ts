import { createServer, type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "01KXDN4AXN6QJBTZTCWP1JWVW4";
const PAGE_ID = "01KXDN4B182DJGAKPX0940H54N";
const PARENT_ID = "01KXDN4B182DJGAKPX0940H55A";
const ROW_ID = "01KXDN4B7A7MYYCTQS1K452QKW";
const COLUMN_ID = "01KXDN4B3X8J9NXGSTMK8PRFMF";
const VIEW_ID = "01KXVVKQ5DC06250MCYVHMJP1V";

const doubles = vi.hoisted(() => ({
  page: {
    all: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    createChild: vi.fn(),
    getDataset: vi.fn(),
    getBreadcrumb: vi.fn(),
  },
  column: {
    all: vi.fn(),
    get: vi.fn(),
    createColumn: vi.fn(),
    updateColumn: vi.fn(),
    resetColumn: vi.fn(),
    deleteColumn: vi.fn(),
  },
  value: {
    createValue: vi.fn(),
    getValue: vi.fn(),
    updateValue: vi.fn(),
    deleteValue: vi.fn(),
  },
  collaborators: {
    listCollaborators: vi.fn(),
    getCollaborator: vi.fn(),
    addCollaborators: vi.fn(),
    removeCollaborator: vi.fn(),
  },
  view: {
    updateFilters: vi.fn(),
    patchView: vi.fn(),
    reconcile: vi.fn(),
  },
  access: {
    canAccessPage: vi.fn(),
    getParentId: vi.fn(),
    listSharedPages: vi.fn(),
  },
  publisher: {
    pageChanged: vi.fn(async () => undefined),
    rowCreated: vi.fn(async () => undefined),
    rowDeleted: vi.fn(async () => undefined),
    columnCreated: vi.fn(async () => undefined),
    columnUpdated: vi.fn(async () => undefined),
    columnReset: vi.fn(async () => undefined),
    columnDeleted: vi.fn(async () => undefined),
    cellUpdated: vi.fn(async () => undefined),
  },
}));

vi.mock("@/controllers/page-controller", () => ({ default: doubles.page }));
vi.mock("@/controllers/page-column-controller", () => ({ default: doubles.column }));
vi.mock("@/controllers/page-column-value-controller", () => ({ default: doubles.value }));
vi.mock("@/controllers/page-collaborator-controller", () => ({
  default: doubles.collaborators,
}));
vi.mock("@/controllers/page-view-controller", () => ({ default: doubles.view }));
vi.mock("@/controllers/page-access-controller", () => ({ default: doubles.access }));
vi.mock("@core/socket/page-realtime-publisher", () => ({ default: doubles.publisher }));
vi.mock("@/core/auth/middleware", () => ({
  default: {
    handle: (request: unknown, _response: unknown, next: () => void) => {
      (request as { userId?: string }).userId = USER_ID;
      next();
    },
  },
}));
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const { default: pageRouter } = await import("@routes/page-route");
  const app = express();
  app.use(express.json());
  app.use("/pages", pageRouter);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Porta efêmera indisponível");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  doubles.access.canAccessPage.mockResolvedValue(true);
  doubles.access.getParentId.mockResolvedValue(PARENT_ID);
});

async function request(
  path: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<Response> {
  const init: RequestInit = {
    method,
    ...(body !== undefined && {
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  };
  return fetch(`${baseUrl}${path}`, init);
}

describe("PageRouter: publicação realtime somente pós-commit", () => {
  it("publica o resultado autoritativo de title/data uma vez e não publica em falha", async () => {
    const page = { id: PAGE_ID, title: "Confirmado", data: { inactiveView: { view: "table" } } };
    doubles.page.update.mockResolvedValueOnce(page);

    const success = await request(`/pages/${PAGE_ID}`, "PUT", {
      title: "Entrada",
      data: { inactiveView: { view: "table" } },
    });

    expect(success.status).toBe(200);
    expect(doubles.publisher.pageChanged).toHaveBeenCalledOnce();
    expect(doubles.publisher.pageChanged).toHaveBeenCalledWith({
      pageId: PAGE_ID,
      title: page.title,
      data: page.data,
      originUserId: USER_ID,
    });

    doubles.publisher.pageChanged.mockClear();
    doubles.page.update.mockResolvedValueOnce(null);
    const failure = await request(`/pages/${PAGE_ID}`, "PUT", { title: "Não gravou" });

    expect(failure.status).toBe(404);
    expect(doubles.publisher.pageChanged).not.toHaveBeenCalled();
  });

  it("produz uma notificação estrutural por criação/exclusão confirmada", async () => {
    doubles.page.createChild.mockResolvedValueOnce({ id: ROW_ID, title: null, data: {} });
    expect((await request(`/pages/${PAGE_ID}/page`, "POST", {})).status).toBe(201);
    expect(doubles.publisher.rowCreated).toHaveBeenCalledOnce();

    doubles.page.delete.mockResolvedValueOnce(true);
    expect((await request(`/pages/${ROW_ID}`, "DELETE")).status).toBe(204);
    expect(doubles.access.getParentId).toHaveBeenCalledWith(ROW_ID);
    expect(doubles.publisher.rowDeleted).toHaveBeenCalledOnce();

    const column = { id: COLUMN_ID, parent_id: PAGE_ID, name: "Nova", type: "text", data: {} };
    doubles.column.createColumn.mockResolvedValueOnce({ ok: true, data: column });
    expect((await request(`/pages/parent/${PAGE_ID}/columns`, "POST", { name: "Nova" })).status)
      .toBe(201);
    expect(doubles.publisher.columnCreated).toHaveBeenCalledOnce();

    doubles.column.deleteColumn.mockResolvedValueOnce({ ok: true, data: { id: COLUMN_ID } });
    expect((await request(`/pages/parent/${PAGE_ID}/columns/${COLUMN_ID}`, "DELETE")).status)
      .toBe(204);
    expect(doubles.publisher.columnDeleted).toHaveBeenCalledOnce();
  });

  it("publica coluna inteira e reset com os valores falsy efetivamente persistidos", async () => {
    const column = {
      id: COLUMN_ID,
      parent_id: PAGE_ID,
      name: "Valor",
      type: "numeric",
      data: { mask: "cpf", format: "currency", currency: "BRL", options: [] },
    };
    doubles.column.updateColumn.mockResolvedValueOnce({ ok: true, data: column });
    expect((await request(
      `/pages/parent/${PAGE_ID}/columns/${COLUMN_ID}`,
      "PUT",
      { name: "Valor", type: "numeric", format: "currency", currency: "BRL" },
    )).status).toBe(200);
    expect(doubles.publisher.columnUpdated).toHaveBeenCalledOnce();
    expect(doubles.publisher.columnUpdated).toHaveBeenCalledWith({
      pageId: PAGE_ID,
      columnId: COLUMN_ID,
      column,
      originUserId: USER_ID,
    });

    const resetCells = [
      { rowId: ROW_ID, value: false },
      { rowId: PAGE_ID, value: 0 },
      { rowId: PARENT_ID, value: "" },
    ];
    doubles.column.resetColumn.mockResolvedValueOnce({
      ok: true,
      data: { column, resetCells },
    });
    expect((await request(
      `/pages/parent/${PAGE_ID}/columns/${COLUMN_ID}/reset`,
      "POST",
    )).status).toBe(200);
    expect(doubles.publisher.columnReset).toHaveBeenCalledOnce();
    expect(doubles.publisher.columnReset).toHaveBeenCalledWith({
      pageId: PAGE_ID,
      columnId: COLUMN_ID,
      column,
      cells: resetCells,
      originUserId: USER_ID,
    });
  });

  it("preserva false, 0, string vazia e null no publisher de célula", async () => {
    doubles.value.createValue.mockResolvedValueOnce({ ok: true, data: { value: false } });
    expect((await request(
      `/pages/${ROW_ID}/column/${COLUMN_ID}/value`,
      "POST",
      { value: false },
    )).status).toBe(201);

    doubles.value.updateValue
      .mockResolvedValueOnce({ ok: true, data: { value: 0 } })
      .mockResolvedValueOnce({ ok: true, data: { value: "" } });
    expect((await request(
      `/pages/${ROW_ID}/column/${COLUMN_ID}/value`,
      "PUT",
      { value: 0 },
    )).status).toBe(200);
    expect((await request(
      `/pages/${ROW_ID}/column/${COLUMN_ID}/value`,
      "PUT",
      { value: "" },
    )).status).toBe(200);

    doubles.value.deleteValue.mockResolvedValueOnce({ ok: true, data: null });
    expect((await request(
      `/pages/${ROW_ID}/column/${COLUMN_ID}/value`,
      "DELETE",
    )).status).toBe(204);

    const cellCalls = doubles.publisher.cellUpdated.mock.calls as unknown as Array<[
      { value: unknown },
    ]>;
    expect(cellCalls.map(([payload]) => payload.value))
      .toEqual([false, 0, "", null]);
    expect(doubles.publisher.cellUpdated).toHaveBeenCalledTimes(4);
  });

  it("não emite quando column/value controller recusa a mutação", async () => {
    doubles.column.updateColumn.mockResolvedValueOnce({
      ok: false,
      reason: "not_found",
      message: "ausente",
    });
    expect((await request(
      `/pages/parent/${PAGE_ID}/columns/${COLUMN_ID}`,
      "PUT",
      { name: "X" },
    )).status).toBe(404);

    doubles.value.updateValue.mockResolvedValueOnce({
      ok: false,
      reason: "not_found",
      message: "ausente",
    });
    expect((await request(
      `/pages/${ROW_ID}/column/${COLUMN_ID}/value`,
      "PUT",
      { value: 1 },
    )).status).toBe(404);

    expect(doubles.publisher.columnUpdated).not.toHaveBeenCalled();
    expect(doubles.publisher.cellUpdated).not.toHaveBeenCalled();
  });

  it("publica exatamente um view-updated após gravar filtros e nenhum em falha", async () => {
    const filters = {
      version: 2,
      updatedAt: "2026-09-01T12:00:00.000Z",
      clauses: [],
      groupBy: [],
      passthrough: [],
    };
    const data = { [VIEW_ID]: { view: "table", name: "Tabela", filters } };
    doubles.view.updateFilters.mockResolvedValueOnce({
      ok: true,
      data: { viewId: VIEW_ID, filters, data },
    });

    const response = await request(`/pages/${PAGE_ID}/views/${VIEW_ID}/filters`, "PUT", {
      version: 2,
      clauses: [],
      groupBy: [],
      passthrough: [],
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ viewId: VIEW_ID, filters });
    expect(doubles.publisher.pageChanged).toHaveBeenCalledOnce();
    expect(doubles.publisher.pageChanged).toHaveBeenCalledWith({
      pageId: PAGE_ID,
      data,
      originUserId: USER_ID,
    });

    doubles.publisher.pageChanged.mockClear();
    doubles.view.updateFilters.mockResolvedValueOnce({
      ok: false,
      reason: "validation",
      message: "inválido",
    });
    expect((await request(
      `/pages/${PAGE_ID}/views/${VIEW_ID}/filters`,
      "PUT",
      { version: 2, updatedAt: "cliente" },
    )).status).toBe(400);
    expect(doubles.publisher.pageChanged).not.toHaveBeenCalled();
  });

  it("patch atômico e reconcile emitem apenas os fatos efetivamente alterados", async () => {
    const view = { view: "table", name: "Tabela", columnWidths: { [COLUMN_ID]: 320 } };
    const data = { [VIEW_ID]: view };
    doubles.view.patchView.mockResolvedValueOnce({
      ok: true,
      data: { viewId: VIEW_ID, view, data, changed: true },
    });
    expect((await request(
      `/pages/${PAGE_ID}/views/${VIEW_ID}`,
      "PATCH",
      { columnWidths: { [COLUMN_ID]: 320 } },
    )).status).toBe(200);
    expect(doubles.publisher.pageChanged).toHaveBeenCalledOnce();

    vi.clearAllMocks();
    doubles.view.patchView.mockResolvedValueOnce({
      ok: true,
      data: { viewId: VIEW_ID, view, data, changed: false },
    });
    expect((await request(`/pages/${PAGE_ID}/views/${VIEW_ID}`, "PATCH", { name: "Tabela" })).status)
      .toBe(200);
    expect(doubles.publisher.pageChanged).not.toHaveBeenCalled();

    const column = { id: COLUMN_ID, parent_id: PAGE_ID, name: "Área", type: "text", data: {} };
    doubles.view.reconcile.mockResolvedValueOnce({
      ok: true,
      data: {
        pageId: PAGE_ID,
        data,
        columns: [column],
        catalog: { views: [], columns: [] },
        changedPage: true,
        changedColumnIds: [COLUMN_ID],
      },
    });
    expect((await request(`/pages/${PAGE_ID}/filter-keys/reconcile`, "POST")).status).toBe(200);
    expect(doubles.publisher.columnUpdated).toHaveBeenCalledOnce();
    expect(doubles.publisher.pageChanged).toHaveBeenCalledOnce();

    doubles.publisher.columnUpdated.mockClear();
    doubles.publisher.pageChanged.mockClear();
    doubles.view.reconcile.mockResolvedValueOnce({
      ok: true,
      data: {
        pageId: PAGE_ID,
        data,
        columns: [column],
        catalog: { views: [], columns: [] },
        changedPage: false,
        changedColumnIds: [],
      },
    });
    expect((await request(`/pages/${PAGE_ID}/filter-keys/reconcile`, "POST")).status).toBe(200);
    expect(doubles.publisher.columnUpdated).not.toHaveBeenCalled();
    expect(doubles.publisher.pageChanged).not.toHaveBeenCalled();
  });

  it("não publica patch ou reconcile quando o commit é recusado", async () => {
    doubles.view.patchView.mockResolvedValueOnce({
      ok: false,
      reason: "not_found",
      message: "View não encontrada",
    });
    expect((await request(
      `/pages/${PAGE_ID}/views/${VIEW_ID}`,
      "PATCH",
      { columnWidths: { [COLUMN_ID]: 320 } },
    )).status).toBe(404);

    doubles.view.reconcile.mockResolvedValueOnce({
      ok: false,
      reason: "server_error",
      message: "Erro no servidor",
    });
    expect((await request(`/pages/${PAGE_ID}/filter-keys/reconcile`, "POST")).status).toBe(500);

    expect(doubles.publisher.pageChanged).not.toHaveBeenCalled();
    expect(doubles.publisher.columnUpdated).not.toHaveBeenCalled();
  });

  it("nega estranho antes do controller e de qualquer emissão", async () => {
    doubles.access.canAccessPage.mockResolvedValueOnce(false);

    const response = await request(`/pages/${PAGE_ID}/views/${VIEW_ID}/filters`, "PUT", {
      version: 2,
      clauses: [],
      groupBy: [],
      passthrough: [],
    });

    expect(response.status).toBe(404);
    expect(doubles.access.canAccessPage).toHaveBeenCalledWith(USER_ID, PAGE_ID);
    expect(doubles.view.updateFilters).not.toHaveBeenCalled();
    expect(doubles.publisher.pageChanged).not.toHaveBeenCalled();
  });
});
