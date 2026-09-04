import { describe, expect, it, vi } from "vitest";
import type { PageEditEmitter } from "@core/socket/page-realtime-publisher";
import { PageRealtimePublisher } from "@core/socket/page-realtime-publisher";
import { RealtimeEventFactory } from "@core/socket/realtime-event-factory";

const PAGE_ID = "01KXDN4B182DJGAKPX0940H54N";
const PARENT_ID = "01KXDN4B182DJGAKPX0940H55A";
const ROW_ID = "01KXDN4B7A7MYYCTQS1K452QKW";
const ROW_ID_2 = "01KXDN4B7A7MYYCTQS1K452QKX";
const COLUMN_ID = "01KXDN4B3X8J9NXGSTMK8PRFMF";
const USER_ID = "01KXDN4AXN6QJBTZTCWP1JWVW4";
const UPDATED_AT = "2026-08-15T20:00:00.000Z";

function emitter() {
  return {
    emitCellUpdated: vi.fn(),
    emitRowUpdated: vi.fn(),
    emitPageUpdated: vi.fn(),
    emitColumnUpdated: vi.fn(),
    emitViewUpdated: vi.fn(),
    emitRowCreated: vi.fn(),
    emitRowDeleted: vi.fn(),
    emitColumnCreated: vi.fn(),
    emitColumnDeleted: vi.fn(),
  } satisfies PageEditEmitter;
}

function publisher(options?: {
  parent?: string | null;
  getParentId?: (pageId: string) => Promise<string | null>;
  now?: () => Date;
}) {
  const edits = emitter();
  const getParentId = vi.fn(
    options?.getParentId ?? (async () => options?.parent === undefined ? PARENT_ID : options.parent),
  );
  const log = vi.fn();
  const realtime = new PageRealtimePublisher(
    edits,
    { getParentId },
    new RealtimeEventFactory(options?.now ?? (() => new Date(UPDATED_AT))),
    log,
  );
  return { realtime, edits, getParentId, log };
}

describe("PageRealtimePublisher", () => {
  it.each([false, 0, "", null])("preserva valor falsy confirmado da celula: %j", async (value) => {
    const { realtime, edits, getParentId } = publisher();
    await realtime.cellUpdated({ rowId: ROW_ID, columnId: COLUMN_ID, value, originUserId: USER_ID });

    expect(getParentId).toHaveBeenCalledWith(ROW_ID);
    expect(edits.emitCellUpdated).toHaveBeenCalledOnce();
    expect(edits.emitCellUpdated).toHaveBeenCalledWith({
      pageId: PARENT_ID,
      rowId: ROW_ID,
      columnId: COLUMN_ID,
      value,
      updatedAt: UPDATED_AT,
      originUserId: USER_ID,
    });
  });

  it("nao publica celula sem parent", async () => {
    const { realtime, edits } = publisher({ parent: null });
    await realtime.cellUpdated({
      rowId: ROW_ID,
      columnId: COLUMN_ID,
      value: "x",
      originUserId: USER_ID,
    });
    expect(edits.emitCellUpdated).not.toHaveBeenCalled();
  });

  it("publica snapshot, chrome e linha do mesmo commit com um timestamp", async () => {
    const now = vi.fn(() => new Date(UPDATED_AT));
    const { realtime, edits } = publisher({ now });
    const data = { view: { name: "Tabela" } };

    await realtime.pageChanged({
      pageId: PAGE_ID,
      title: "Titulo novo",
      data,
      originUserId: USER_ID,
    });

    expect(now).toHaveBeenCalledOnce();
    expect(edits.emitViewUpdated).toHaveBeenCalledWith({
      pageId: PAGE_ID,
      data,
      updatedAt: UPDATED_AT,
      originUserId: USER_ID,
    });
    expect(edits.emitPageUpdated).toHaveBeenCalledWith({
      pageId: PAGE_ID,
      title: "Titulo novo",
      updatedAt: UPDATED_AT,
      originUserId: USER_ID,
    });
    expect(edits.emitRowUpdated).toHaveBeenCalledWith({
      pageId: PARENT_ID,
      rowId: PAGE_ID,
      title: "Titulo novo",
      updatedAt: UPDATED_AT,
      originUserId: USER_ID,
    });
  });

  it("publica page-updated mesmo quando a pagina nao tem parent", async () => {
    const { realtime, edits } = publisher({ parent: null });
    await realtime.pageChanged({ pageId: PAGE_ID, title: null, originUserId: USER_ID });
    expect(edits.emitPageUpdated).toHaveBeenCalledOnce();
    expect(edits.emitRowUpdated).not.toHaveBeenCalled();
  });

  it("substitui a coluna inteira", async () => {
    const { realtime, edits } = publisher();
    const column = {
      id: COLUMN_ID,
      name: "Status",
      type: "select",
      data: { options: [{ value: "Todo", color: "blue" }], mask: "uppercase" },
      format: "currency",
      currency: "BRL",
    };
    await realtime.columnUpdated({
      pageId: PAGE_ID,
      columnId: COLUMN_ID,
      column,
      originUserId: USER_ID,
    });
    expect(edits.emitColumnUpdated).toHaveBeenCalledWith({
      pageId: PAGE_ID,
      columnId: COLUMN_ID,
      column,
      updatedAt: UPDATED_AT,
      originUserId: USER_ID,
    });
  });

  it("mantem um timestamp no reset e preserva defaults falsy de cada celula", async () => {
    const now = vi.fn(() => new Date(UPDATED_AT));
    const { realtime, edits } = publisher({ now });
    await realtime.columnReset({
      pageId: PAGE_ID,
      columnId: COLUMN_ID,
      column: { id: COLUMN_ID, type: "checkbox" },
      cells: [
        { rowId: ROW_ID, value: false },
        { rowId: ROW_ID_2, value: 0 },
        { rowId: PAGE_ID, value: "" },
      ],
      originUserId: USER_ID,
    });

    expect(now).toHaveBeenCalledOnce();
    expect(edits.emitColumnUpdated.mock.calls[0]?.[0].updatedAt).toBe(UPDATED_AT);
    expect(edits.emitCellUpdated.mock.calls.map(([payload]) => payload.value)).toEqual([
      false,
      0,
      "",
    ]);
    expect(
      edits.emitCellUpdated.mock.calls.map(([payload]) => payload.updatedAt),
    ).toEqual([UPDATED_AT, UPDATED_AT, UPDATED_AT]);
  });

  it("produz eventos estruturais de linha e coluna", async () => {
    const { realtime, edits } = publisher();
    const base = { pageId: PAGE_ID, originUserId: USER_ID };
    await realtime.rowCreated({ ...base, rowId: ROW_ID });
    await realtime.rowDeleted({ ...base, rowId: ROW_ID });
    const column = { id: COLUMN_ID, name: "Nova", type: "text", data: {} };
    await realtime.columnCreated({ ...base, columnId: COLUMN_ID, column });
    await realtime.columnDeleted({ ...base, columnId: COLUMN_ID });

    const metadata = { updatedAt: UPDATED_AT, originUserId: USER_ID };
    expect(edits.emitRowCreated).toHaveBeenCalledWith({
      pageId: PAGE_ID,
      rowId: ROW_ID,
      ...metadata,
    });
    expect(edits.emitRowDeleted).toHaveBeenCalledWith({
      pageId: PAGE_ID,
      rowId: ROW_ID,
      ...metadata,
    });
    expect(edits.emitColumnCreated).toHaveBeenCalledWith({
      pageId: PAGE_ID,
      columnId: COLUMN_ID,
      column,
      ...metadata,
    });
    expect(edits.emitColumnDeleted).toHaveBeenCalledWith({
      pageId: PAGE_ID,
      columnId: COLUMN_ID,
      ...metadata,
    });
  });

  it("engole falha de broadcast pos-commit e continua o restante do lote", async () => {
    const { realtime, edits, log } = publisher();
    edits.emitPageUpdated.mockImplementationOnce(() => {
      throw new Error("adapter indisponivel");
    });

    await expect(realtime.pageChanged({
      pageId: PAGE_ID,
      title: "Ainda persistiu",
      data: { ok: true },
      originUserId: USER_ID,
    })).resolves.toBeUndefined();

    expect(edits.emitViewUpdated).toHaveBeenCalledOnce();
    expect(edits.emitRowUpdated).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(
      `[cubs:realtime] Falha ao publicar page-updated na pagina ${PAGE_ID}`,
      expect.any(Error),
    );
  });

  it("engole falha ao resolver parent sem contaminar o caller HTTP", async () => {
    const failure = new Error("rqlite offline");
    const { realtime, edits, log } = publisher({
      getParentId: async () => { throw failure; },
    });

    await expect(realtime.cellUpdated({
      rowId: ROW_ID,
      columnId: COLUMN_ID,
      value: "persistido",
      originUserId: USER_ID,
    })).resolves.toBeUndefined();
    expect(edits.emitCellUpdated).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      `[cubs:realtime] Falha ao resolver parent para cell-updated da pagina ${ROW_ID}`,
      failure,
    );
  });
});
