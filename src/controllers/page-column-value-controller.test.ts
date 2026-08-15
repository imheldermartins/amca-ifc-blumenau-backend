import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  values: {
    findAll: vi.fn(),
    find: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  columns: {
    find: vi.fn(),
  },
  edges: {
    find: vi.fn(),
  },
}));

vi.mock("@models/index", () => ({
  default: {
    pageColumnValues: dbMocks.values,
    pageColumns: dbMocks.columns,
    pageEdges: dbMocks.edges,
  },
}));

import pageColumnValueController from "@controllers/page-column-value-controller";

const ROW_ID = "01KXDN4B7A7MYYCTQS1K452QKW";
const COLUMN_ID = "01KXDN4B3X8J9NXGSTMK8PRFMF";
const PARENT_ID = "01KXDN4B182DJGAKPX0940H54N";
const OTHER_PARENT_ID = "01KY3TR7GVT4QBZ8D4E52HSNHR";
const VALUE_ID = "01KXDN4B9MDCN9XAB23H8DSWCV";

const textColumn = {
  id: COLUMN_ID,
  name: "Texto",
  type: "text",
  data: {},
  parent_id: PARENT_ID,
};

const existingValue = {
  id: VALUE_ID,
  page_id: ROW_ID,
  page_column_id: COLUMN_ID,
  data: JSON.stringify({ value: "anterior" }),
};

beforeEach(() => {
  for (const mock of [
    ...Object.values(dbMocks.values),
    ...Object.values(dbMocks.columns),
    ...Object.values(dbMocks.edges),
  ]) {
    mock.mockReset();
  }
});

describe("page-column-value-controller — endereço da célula", () => {
  it("recusa POST quando a coluna não pertence à parent direta da row", async () => {
    dbMocks.columns.find.mockResolvedValue({ ...textColumn, parent_id: OTHER_PARENT_ID });
    dbMocks.edges.find.mockResolvedValue(null);

    const result = await pageColumnValueController.createValue({
      page_id: ROW_ID,
      page_column_id: COLUMN_ID,
      value: "novo",
    });

    expect(result).toEqual({
      ok: false,
      reason: "not_found",
      message: `"Page_column" não encontrado`,
    });
    expect(dbMocks.edges.find).toHaveBeenCalledWith({
      parent_id: OTHER_PARENT_ID,
      child_id: ROW_ID,
    });
    expect(dbMocks.values.find).not.toHaveBeenCalled();
    expect(dbMocks.values.create).not.toHaveBeenCalled();
  });

  it("recusa PUT de uma célula histórica cruzada entre databases", async () => {
    dbMocks.values.find.mockResolvedValue(existingValue);
    dbMocks.columns.find.mockResolvedValue({ ...textColumn, parent_id: OTHER_PARENT_ID });
    dbMocks.edges.find.mockResolvedValue(null);

    const result = await pageColumnValueController.updateValue(ROW_ID, COLUMN_ID, {
      value: "novo",
    });

    expect(result).toMatchObject({ ok: false, reason: "not_found" });
    expect(dbMocks.values.update).not.toHaveBeenCalled();
  });

  it("recusa DELETE quando coluna e row não formam uma célula da mesma parent", async () => {
    dbMocks.values.find.mockResolvedValue(existingValue);
    dbMocks.columns.find.mockResolvedValue({ ...textColumn, parent_id: OTHER_PARENT_ID });
    dbMocks.edges.find.mockResolvedValue(null);

    const result = await pageColumnValueController.deleteValue(ROW_ID, COLUMN_ID);

    expect(result).toMatchObject({ ok: false, reason: "not_found" });
    expect(dbMocks.values.delete).not.toHaveBeenCalled();
  });

  it("aceita a relação direta e devolve o range de date exatamente como persistido", async () => {
    const startDate = "2026-08-15T10:00:00.000Z";
    const endDate = "2026-08-15T11:00:00.000Z";
    const persisted = `${startDate}@${endDate}`;

    dbMocks.columns.find.mockResolvedValue({ ...textColumn, type: "date" });
    dbMocks.edges.find.mockResolvedValue({ parent_id: PARENT_ID, child_id: ROW_ID });
    dbMocks.values.find.mockResolvedValue(null);
    dbMocks.values.create.mockImplementation(async (data) => ({
      id: VALUE_ID,
      ...data,
    }));

    const result = await pageColumnValueController.createValue({
      page_id: ROW_ID,
      page_column_id: COLUMN_ID,
      startDate,
      endDate,
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        page_id: ROW_ID,
        page_column_id: COLUMN_ID,
        type: "date",
        value: persisted,
      },
    });
    expect(dbMocks.edges.find).toHaveBeenCalledWith({
      parent_id: PARENT_ID,
      child_id: ROW_ID,
    });
    expect(dbMocks.values.create).toHaveBeenCalledWith({
      page_id: ROW_ID,
      page_column_id: COLUMN_ID,
      data: JSON.stringify({ value: persisted }),
    });
  });
});
