import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Schema } from "@models/schemas/index";

const db = vi.hoisted(() => ({
  columns: {
    find: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  values: {
    findAll: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  pages: {
    find: vi.fn(),
  },
}));

vi.mock("@models/index", () => ({
  default: {
      pageColumns: db.columns,
      pageColumnValues: db.values,
      pages: db.pages,
  },
}));

import pageColumnController from "./page-column-controller.js";

const PAGE_ID = "01KXVZ00000000000000000001";
const COLUMN_ID = "01KXVZ00000000000000000002";
const OTHER_COLUMN_ID = "01KXVZ00000000000000000003";
const OPTION_ID = "01KXVZ00000000000000000004";
const NEW_OPTION_ID = "01KXVZ00000000000000000005";
const dates = {
  created_at: new Date("2026-08-01T00:00:00.000Z"),
  updated_at: new Date("2026-08-02T00:00:00.000Z"),
};

function column(overrides: Partial<Schema.PageColumn> = {}): Schema.PageColumn {
  return {
    id: COLUMN_ID,
    parent_id: PAGE_ID,
    name: "Área",
    type: "text",
    data: { publicKey: { key: "area", aliases: [] } },
    ...dates,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.columns.findAll.mockResolvedValue([]);
  db.columns.update.mockResolvedValue(true);
  db.pages.find.mockResolvedValue({ data: {} });
});

describe("PageColumnController: public keys", () => {
  it("sufixa label e key de uma coluna nova duplicada", async () => {
    db.columns.findAll.mockResolvedValueOnce([
      column({ id: OTHER_COLUMN_ID, data: {} }),
    ]);
    db.columns.create.mockImplementation(async (input) => ({
      id: COLUMN_ID,
      ...dates,
      ...input,
    }));

    const result = await pageColumnController.createColumn({
      parent_id: PAGE_ID,
      name: "Área",
      type: "text",
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        name: "Área (2)",
        data: { publicKey: { key: "area_2", aliases: [] } },
      },
    });
    expect(db.columns.create).toHaveBeenCalledWith({
      parent_id: PAGE_ID,
      name: "Área (2)",
      type: "text",
      data: { publicKey: { key: "area_2", aliases: [] } },
    });
  });

  it("não permite que coluna real reutilize a key sintética de título", async () => {
    db.pages.find.mockResolvedValueOnce({
      data: {
        "01KXVZ00000000000000000006": {
          view: "table",
          title: {
            key: "title",
            column_name: "Título",
            publicKey: { key: "titulo", aliases: [] },
          },
        },
      },
    });
    db.columns.create.mockImplementation(async (input) => ({
      id: COLUMN_ID,
      ...dates,
      ...input,
    }));

    const result = await pageColumnController.createColumn({
      parent_id: PAGE_ID,
      name: "Título",
      type: "text",
    });

    expect(result).toMatchObject({
      ok: true,
      data: { data: { publicKey: { key: "titulo_2", aliases: [] } } },
    });
  });

  it("mantém option existente e diferencia uma option nova homônima", async () => {
    const existing = column({
      type: "select",
      data: {
        publicKey: { key: "area", aliases: [] },
        options: [
          {
            id: OPTION_ID,
            value: "Administração",
            color: "blue",
            publicKey: { key: "administracao", aliases: [] },
          },
        ],
      },
    });
    const expectedOptions: Schema.SelectOption[] = [
      existing.data.options![0]!,
      {
        id: NEW_OPTION_ID,
        value: "Administração (2)",
        color: "purple",
        publicKey: { key: "administracao_2", aliases: [] },
      },
    ];
    const persisted = column({
      type: "select",
      data: { ...existing.data, options: expectedOptions },
    });
    db.columns.find.mockResolvedValueOnce(existing).mockResolvedValueOnce(persisted);
    db.columns.findAll.mockResolvedValueOnce([existing]);

    const result = await pageColumnController.updateColumn(
      { id: COLUMN_ID, parent_id: PAGE_ID },
      {
        options: [
          { id: OPTION_ID, value: "Administração", color: "blue" },
          { id: NEW_OPTION_ID, value: "Administração", color: "purple" },
        ],
      },
    );

    expect(result).toEqual({ ok: true, data: persisted });
    expect(db.columns.update).toHaveBeenCalledWith(
      { data: { ...existing.data, options: expectedOptions } },
      { id: COLUMN_ID, parent_id: PAGE_ID },
    );
  });

  it("trata falha ao listar o escopo como erro de infraestrutura", async () => {
    db.columns.findAll.mockRejectedValueOnce(new Error("rqlite indisponível"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      pageColumnController.createColumn({ parent_id: PAGE_ID, name: "Área", type: "text" }),
    ).resolves.toEqual({ ok: false, reason: "server_error", message: "Erro no servidor" });

    log.mockRestore();
    expect(db.columns.create).not.toHaveBeenCalled();
  });
});
