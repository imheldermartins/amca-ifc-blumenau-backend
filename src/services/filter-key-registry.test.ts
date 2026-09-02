import { describe, expect, it } from "vitest";

import {
  appendDeletedColumnKeys,
  collectPageColumnReservations,
  optionTombstones,
  readDeletedColumnKeys,
} from "./filter-key-registry.js";

describe("filter key registry", () => {
  it("reserva tombstones e todas as keys sintéticas de título", () => {
    const data = {
      __filterKeyRegistry: { columns: ["status_antigo"] },
      "01KXVZ00000000000000000001": {
        view: "table",
        title: {
          key: "title",
          column_name: "Título",
          publicKey: { key: "titulo", aliases: ["nome"] },
        },
      },
    };

    expect(collectPageColumnReservations(data)).toEqual(
      new Set(["status_antigo", "titulo", "nome"]),
    );
  });

  it("preserva key e aliases da coluna excluída", () => {
    const keys = appendDeletedColumnKeys(
      { __filterKeyRegistry: { columns: ["legada"] } },
      {
        name: "Status",
        data: { publicKey: { key: "situacao", aliases: ["status"] } },
      },
    );

    expect(keys).toEqual(["legada", "situacao", "status"]);
    expect(readDeletedColumnKeys({ __filterKeyRegistry: { columns: keys } })).toEqual(
      new Set(keys),
    );
  });

  it("mantém tombstones de options removidas", () => {
    expect(
      optionTombstones(
        [
          {
            id: "01KXVZ00000000000000000002",
            value: "Administração",
            publicKey: { key: "administracao", aliases: ["admin"] },
          },
        ],
        new Set(),
        ["legada"],
      ),
    ).toEqual(["admin", "administracao", "legada"]);
  });
});
