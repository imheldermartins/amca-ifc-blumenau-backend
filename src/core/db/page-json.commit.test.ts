import { beforeEach, describe, expect, it, vi } from "vitest";

const shared = vi.hoisted(() => ({ rqlite: vi.fn() }));

vi.mock("./shared.js", () => ({ rqlite: shared.rqlite }));

import { commitFilterKeyReconcile } from "./page-json.js";

const PAGE_ID = "01KXVZ00000000000000000001";
const COLUMN_ID = "01KXVZ00000000000000000002";

beforeEach(() => {
  shared.rqlite.mockReset();
});

describe("commitFilterKeyReconcile", () => {
  it("protege página e colunas no mesmo batch transacional", async () => {
    // Dois guards sem escrita (false) e duas atualizações efetivas (true).
    shared.rqlite.mockResolvedValue([false, false, true, true]);

    await expect(
      commitFilterKeyReconcile({
        pageId: PAGE_ID,
        pagePatches: [{ path: ["view", "filters"], value: { version: 2 } }],
        columns: [{ id: COLUMN_ID, data: { publicKey: { key: "status", aliases: [] } } }],
      }),
    ).resolves.toBe(true);

    const [statements, endpoint, options] = shared.rqlite.mock.calls[0]!;
    expect(endpoint).toBe("execute");
    expect(options).toEqual({ transaction: true });
    expect(statements).toHaveLength(4);
    expect(statements[0][0]).toContain("WHERE NOT EXISTS (SELECT 1 FROM pages");
    expect(statements[1][0]).toContain("WHERE NOT EXISTS (SELECT 1 FROM page_columns");
  });

  it("propaga a falha do guard para impedir commit parcial", async () => {
    shared.rqlite.mockRejectedValueOnce(new Error("constraint failed"));

    await expect(
      commitFilterKeyReconcile({
        pageId: PAGE_ID,
        pagePatches: [],
        columns: [{ id: COLUMN_ID, data: {} }],
      }),
    ).rejects.toThrow("constraint failed");
  });
});
