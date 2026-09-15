import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rqlite = vi.hoisted(() => vi.fn());

vi.mock("./shared.js", () => ({ rqlite }));

import {
  buildInsertPageViewStatement,
  buildUpdatePageJsonPathsStatement,
  buildUpdatePageViewFiltersStatement,
  commitFilterKeyReconcile,
} from "./page-json.js";

const PAGE_ID = "01KXVZ00000000000000000001";
const VIEW_ID = "01KXVZ00000000000000000002";
const OTHER_VIEW_ID = "01KXVZ00000000000000000003";
const COLUMN_ID = "01KXVZ00000000000000000004";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("page JSON updates", () => {
  it("insere somente a nova view e conserva alterações concorrentes nas demais", () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec("CREATE TABLE pages (id TEXT PRIMARY KEY, data TEXT, updated_at TEXT, deleted_at TEXT)");
    sqlite.prepare("INSERT INTO pages (id, data) VALUES (?, ?)").run(PAGE_ID, JSON.stringify({
      [OTHER_VIEW_ID]: { view: "table", name: "Existente" },
      unrelated: { keep: true },
    }));
    const view = { view: "board", name: "Quadros", orderedHeaderCols: [] };
    const statement = buildInsertPageViewStatement(PAGE_ID, VIEW_ID, view);
    expect(statement.text).not.toContain(VIEW_ID);
    const inserted = sqlite.prepare(statement.text).run(...(statement.values as string[]));
    expect(inserted.changes).toBe(1);
    expect(sqlite.prepare(statement.text).run(...(statement.values as string[])).changes).toBe(0);
    const row = sqlite.prepare("SELECT data FROM pages WHERE id = ?").get(PAGE_ID) as { data: string };
    expect(JSON.parse(row.data)).toEqual({
      [OTHER_VIEW_ID]: { view: "table", name: "Existente" },
      unrelated: { keep: true },
      [VIEW_ID]: view,
    });
    sqlite.close();
  });

  it("parametriza path, documento e ids no patch atomico da view", () => {
    const statement = buildUpdatePageViewFiltersStatement(PAGE_ID, VIEW_ID, {
      version: 2,
      updatedAt: "2026-09-01T10:00:00.000Z",
      clauses: [],
      groupBy: [],
      passthrough: [],
    });

    expect(statement.text).not.toContain(PAGE_ID);
    expect(statement.text).not.toContain(VIEW_ID);
    expect(statement.text).toContain("json_set");
    expect(statement.values).toEqual([
      `$.\"${VIEW_ID}\".filters`,
      expect.stringContaining('"version":2'),
      PAGE_ID,
      `$.\"${VIEW_ID}\"`,
      `$.\"${VIEW_ID}\".deletedAt`,
    ]);
  });

  it("soft delete preserva o snapshot e bloqueia patches e duplicação posteriores", () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec("CREATE TABLE pages (id TEXT PRIMARY KEY, data TEXT, updated_at TEXT, deleted_at TEXT)");
    const original = {
      [VIEW_ID]: { view: "table", name: "Original", filters: { version: 2, clauses: [] } },
      [OTHER_VIEW_ID]: { view: "board", name: "Outra" },
    };
    sqlite.prepare("INSERT INTO pages (id, data) VALUES (?, ?)").run(PAGE_ID, JSON.stringify(original));
    const deletedAt = "2026-09-13T12:00:00.000Z";
    const deletion = buildUpdatePageJsonPathsStatement(PAGE_ID, [{ path: [VIEW_ID, "deletedAt"], value: deletedAt }], VIEW_ID);
    expect(sqlite.prepare(deletion.text).run(...(deletion.values as string[])).changes).toBe(1);
    expect(sqlite.prepare(deletion.text).run(...(deletion.values as string[])).changes).toBe(0);
    const patch = buildUpdatePageJsonPathsStatement(PAGE_ID, [{ path: [VIEW_ID, "name"], value: "Alterada" }], VIEW_ID);
    expect(sqlite.prepare(patch.text).run(...(patch.values as string[])).changes).toBe(0);
    const duplicate = buildInsertPageViewStatement(PAGE_ID, COLUMN_ID, { view: "table", name: "Cópia" }, VIEW_ID);
    expect(sqlite.prepare(duplicate.text).run(...(duplicate.values as string[])).changes).toBe(0);
    const row = sqlite.prepare("SELECT data FROM pages WHERE id = ?").get(PAGE_ID) as { data: string };
    expect(JSON.parse(row.data)).toEqual({ ...original, [VIEW_ID]: { ...original[VIEW_ID], deletedAt } });
    sqlite.close();
  });

  it("protege todos os alvos durante a reordenação de views", () => {
    const expectedData = {
      [VIEW_ID]: { view: "table", order: 0 },
      [OTHER_VIEW_ID]: { view: "graph", order: 1 },
    };
    const statement = buildUpdatePageJsonPathsStatement(
      PAGE_ID,
      [
        { path: [VIEW_ID, "order"], value: 1 },
        { path: [OTHER_VIEW_ID, "order"], value: 0 },
      ],
      [VIEW_ID, OTHER_VIEW_ID],
      expectedData,
    );
    expect(statement.text.match(/json_type\(data, \?\)/g)).toHaveLength(2);
    expect(statement.values.slice(-5)).toEqual([
      `$.\"${VIEW_ID}\"`,
      `$.\"${VIEW_ID}\".deletedAt`,
      `$.\"${OTHER_VIEW_ID}\"`,
      `$.\"${OTHER_VIEW_ID}\".deletedAt`,
      JSON.stringify(expectedData),
    ]);

    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec("CREATE TABLE pages (id TEXT PRIMARY KEY, data TEXT, updated_at TEXT, deleted_at TEXT)");
    sqlite.prepare("INSERT INTO pages (id, data) VALUES (?, ?)").run(PAGE_ID, JSON.stringify({
      ...expectedData,
      [COLUMN_ID]: { view: "grid", order: 2 },
    }));
    expect(sqlite.prepare(statement.text).run(...(statement.values as string[])).changes).toBe(0);
    sqlite.close();
  });

  it("recusa ids fora do contrato antes de montar o JSON path", () => {
    expect(() => buildUpdatePageViewFiltersStatement(PAGE_ID, 'x".filters', {})).toThrow(
      "Invalid page or view id",
    );
  });

  it("preserva campos da mesma view e todas as outras views em patches sucessivos", () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(
      "CREATE TABLE pages (id TEXT PRIMARY KEY, data TEXT, updated_at TEXT, deleted_at TEXT)",
    );
    const original = {
      [VIEW_ID]: {
        view: "table",
        filters: { version: 2, updatedAt: null, clauses: [], groupBy: [], passthrough: [] },
        columnWidths: { [COLUMN_ID]: 180 },
      },
      [OTHER_VIEW_ID]: { view: "table", name: "Não tocar" },
      unrelated: { preserved: true },
    };
    sqlite.prepare("INSERT INTO pages (id, data) VALUES (?, ?)").run(PAGE_ID, JSON.stringify(original));

    const filters = {
      version: 2,
      updatedAt: "2026-09-01T10:00:00.000Z",
      clauses: [],
      groupBy: ["page_title"],
      passthrough: [],
    };
    const filtersStatement = buildUpdatePageViewFiltersStatement(PAGE_ID, VIEW_ID, filters);
    sqlite.prepare(filtersStatement.text).run(...(filtersStatement.values as string[]));

    const widthsStatement = buildUpdatePageJsonPathsStatement(
      PAGE_ID,
      [{ path: [VIEW_ID, "columnWidths"], value: { [COLUMN_ID]: 320 } }],
      VIEW_ID,
    );
    sqlite.prepare(widthsStatement.text).run(...(widthsStatement.values as string[]));

    const row = sqlite.prepare("SELECT data FROM pages WHERE id = ?").get(PAGE_ID) as { data: string };
    const persisted = JSON.parse(row.data) as typeof original;
    expect(persisted[VIEW_ID].filters).toEqual(filters);
    expect(persisted[VIEW_ID].columnWidths).toEqual({ [COLUMN_ID]: 320 });
    expect(persisted[OTHER_VIEW_ID]).toEqual(original[OTHER_VIEW_ID]);
    expect(persisted.unrelated).toEqual(original.unrelated);
    sqlite.close();
  });

  it("envia o reconcile inteiro como uma única transação rqlite", async () => {
    // Guards de existência não alteram linhas; os dois writes seguintes sim.
    rqlite.mockResolvedValue([false, false, true, true]);

    await expect(
      commitFilterKeyReconcile({
        pageId: PAGE_ID,
        pagePatches: [{ path: [VIEW_ID, "urlKey"], value: { key: "tabela", aliases: [] } }],
        columns: [{ id: COLUMN_ID, data: { publicKey: { key: "area", aliases: [] } } }],
      }),
    ).resolves.toBe(true);

    expect(rqlite).toHaveBeenCalledOnce();
    expect(rqlite).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.arrayContaining([expect.stringContaining("WHERE NOT EXISTS")]),
        expect.arrayContaining([expect.stringContaining("UPDATE pages")]),
        expect.arrayContaining([expect.stringContaining("UPDATE page_columns")]),
      ]),
      "execute",
      { transaction: true },
    );
  });
});
