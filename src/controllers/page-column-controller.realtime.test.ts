import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  columns: {
    find: vi.fn(),
    update: vi.fn(),
  },
  values: {
    findAll: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("@models/index", () => ({
  default: {
    pageColumns: dbMocks.columns,
    pageColumnValues: dbMocks.values,
  },
}));

import pageColumnController from "@controllers/page-column-controller";
import type { Schema } from "@models/schemas/index";

const PAGE_ID = "01KXDN4B182DJGAKPX0940H54N";
const ROW_ID = "01KXDN4B7A7MYYCTQS1K452QKW";
const COLUMN_ID = "01KXDN4B3X8J9NXGSTMK8PRFMF";
const VALUE_ID = "01KXDN4B9MDCN9XAB23H8DSWCV";

beforeEach(() => {
  for (const mock of [...Object.values(dbMocks.columns), ...Object.values(dbMocks.values)]) {
    mock.mockReset();
  }
  dbMocks.columns.update.mockResolvedValue(true);
  dbMocks.values.update.mockResolvedValue(true);
  dbMocks.values.delete.mockResolvedValue(true);
});

describe("PageColumnController: resultado autoritativo do reset", () => {
  it.each([
    ["text", ""],
    ["numeric", 0],
    ["checkbox", false],
    ["select", null],
    ["date", null],
  ] as const)("expõe o valor persistido para reset de %s", async (type, expectedValue) => {
    const existing = {
      id: COLUMN_ID,
      created_at: new Date("2026-08-15T19:00:00.000Z"),
      updated_at: new Date("2026-08-15T20:00:00.000Z"),
      parent_id: PAGE_ID,
      name: "Coluna",
      type,
      data: { mask: "cpf", options: [] },
    } satisfies Schema.PageColumn;
    const resetColumn = {
      ...existing,
      data: type === "select" ? { options: [] } : {},
    } satisfies Schema.PageColumn;

    dbMocks.columns.find
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(resetColumn);
    dbMocks.values.findAll.mockResolvedValueOnce([
      {
        id: VALUE_ID,
        page_id: ROW_ID,
        page_column_id: COLUMN_ID,
        data: JSON.stringify({ value: null }),
      },
    ]);

    const result = await pageColumnController.resetColumn({
      id: COLUMN_ID,
      parent_id: PAGE_ID,
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        column: resetColumn,
        resetCells: [{ rowId: ROW_ID, value: expectedValue }],
      },
    });

    if (expectedValue === null) {
      expect(dbMocks.values.delete).toHaveBeenCalledWith({ id: VALUE_ID });
      expect(dbMocks.values.update).not.toHaveBeenCalled();
    } else {
      expect(dbMocks.values.update).toHaveBeenCalledWith(
        { data: JSON.stringify({ value: expectedValue }) },
        { id: VALUE_ID },
      );
      expect(dbMocks.values.delete).not.toHaveBeenCalled();
    }
  });
});
