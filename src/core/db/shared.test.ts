import { describe, expect, it } from "vitest";

import { parseRqliteResults } from "./shared.js";

describe("parseRqliteResults", () => {
  it("preserva as linhas de uma consulta", () => {
    const rows = [{ id: "01KXVZ00000000000000000000" }];

    expect(parseRqliteResults([{ types: { id: "text" }, rows }])).toEqual([rows]);
  });

  it("reconhece INSERT pelo número de linhas afetadas", () => {
    expect(parseRqliteResults([{ last_insert_id: 42, rows_affected: 1 }])).toEqual([true]);
  });

  it("reconhece UPDATE/DELETE sem last_insert_id", () => {
    expect(parseRqliteResults([{ rows_affected: 1, rows: null }])).toEqual([true]);
  });

  it("mantém como falha uma escrita que não atingiu linhas", () => {
    expect(parseRqliteResults([{ rows_affected: 0, rows: null }])).toEqual([false]);
  });

  it("propaga erros SQL com a causa esperada", () => {
    expect(() => parseRqliteResults([{ error: "constraint failed" }])).toThrowError(
      expect.objectContaining({ message: "[constraint failed]", cause: "SQLERROR" }),
    );
  });

  it("rejeita uma resposta ausente do rqlite", () => {
    expect(() => parseRqliteResults(undefined)).toThrowError(
      expect.objectContaining({ message: "Results is invalid.", cause: "SQLERROR" }),
    );
  });
});
