import { describe, expect, it } from "vitest";

import {
  parseViewFiltersWrite,
  reconcileViewFilters,
  ViewFiltersValidationError,
  type FilterColumnDefinition,
} from "./view-filters-v2.js";

const COLUMNS: FilterColumnDefinition[] = [
  { id: "page_title", type: "text" },
  { id: "01KXVZ00000000000000000001", type: "numeric" },
  {
    id: "01KXVZ00000000000000000002",
    type: "select",
    options: [
      {
        id: "01KXVZ00000000000000000003",
        value: "Administração",
        publicKey: { key: "administracao", aliases: [] },
      },
    ],
  },
];

describe("filters v2", () => {
  it("converte string v1 de forma idempotente e preserva passthrough", () => {
    const legacy = new URLSearchParams();
    legacy.set("v", "1");
    legacy.append("group", COLUMNS[0]!.id);
    legacy.append(
      "where",
      JSON.stringify({ columnId: COLUMNS[1]!.id, condition: "greaterThan", values: ["10"] }),
    );
    legacy.append("order", "updated_at");

    const once = reconcileViewFilters(legacy.toString(), COLUMNS);
    const twice = reconcileViewFilters(once, COLUMNS);
    expect(twice).toEqual(once);
    expect(once).toMatchObject({
      version: 2,
      updatedAt: null,
      groupBy: ["page_title"],
      clauses: [{ columnId: COLUMNS[1]!.id, condition: "greaterThan", values: ["10"] }],
      passthrough: [["order", "updated_at"]],
    });
  });

  it("remove coluna, option e condição incompatível", () => {
    const result = reconcileViewFilters(
      {
        version: 2,
        updatedAt: null,
        clauses: [
          { columnId: "removed", condition: "equals", values: ["x"] },
          { columnId: COLUMNS[1]!.id, condition: "contains", values: ["1"] },
          { columnId: COLUMNS[2]!.id, condition: "equals", values: ["removed-option"] },
        ],
        groupBy: ["removed", "page_title", "page_title"],
        passthrough: [],
      },
      COLUMNS,
    );

    expect(result.clauses).toEqual([]);
    expect(result.groupBy).toEqual(["page_title"]);
  });

  it("carimba somente o timestamp informado pelo servidor e poda option excluída", () => {
    const result = parseViewFiltersWrite(
      {
        version: 2,
        clauses: [
          {
            columnId: COLUMNS[2]!.id,
            condition: "equals",
            values: [COLUMNS[2]!.options![0]!.id, "deleted"],
          },
        ],
        groupBy: [],
        passthrough: [],
      },
      COLUMNS,
      "2026-09-01T12:00:00.000Z",
    );

    expect(result.updatedAt).toBe("2026-09-01T12:00:00.000Z");
    expect(result.clauses[0]?.values).toEqual([COLUMNS[2]!.options![0]!.id]);
  });

  it("poda referências excluídas entre o load e o write sem recusar o documento", () => {
    const result = parseViewFiltersWrite(
      {
        version: 2,
        clauses: [
          { columnId: "removed-column", condition: "contains", values: ["qualquer"] },
          {
            columnId: COLUMNS[2]!.id,
            condition: "equals",
            values: ["removed-option"],
          },
        ],
        groupBy: ["removed-column", COLUMNS[0]!.id],
        passthrough: [],
      },
      COLUMNS,
      "2026-09-01T12:00:00.000Z",
    );

    expect(result.clauses).toEqual([]);
    expect(result.groupBy).toEqual([COLUMNS[0]!.id]);
  });

  it.each([
    ["condição incompatível", COLUMNS[1]!.id, "contains", ["1"]],
    ["número inválido", COLUMNS[1]!.id, "equals", ["um"]],
    ["select com condição incompatível", COLUMNS[2]!.id, "contains", [COLUMNS[2]!.options![0]!.id]],
    ["select sem valor", COLUMNS[2]!.id, "equals", []],
    ["select com valor vazio", COLUMNS[2]!.id, "equals", [""]],
    ["texto contains vazio", COLUMNS[0]!.id, "contains", [""]],
  ])("recusa %s em coluna existente", (_label, columnId, condition, values) => {
    expect(() =>
      parseViewFiltersWrite(
        {
          version: 2,
          clauses: [{ columnId, condition, values }],
          groupBy: [],
          passthrough: [],
        },
        COLUMNS,
        "2026-09-01T12:00:00.000Z",
      ),
    ).toThrow(ViewFiltersValidationError);
  });

  it("recusa updatedAt e campos desconhecidos do cliente", () => {
    expect(() =>
      parseViewFiltersWrite(
        { version: 2, updatedAt: "client", clauses: [], groupBy: [], passthrough: [] },
        COLUMNS,
        "server",
      ),
    ).toThrow(ViewFiltersValidationError);
  });
});
