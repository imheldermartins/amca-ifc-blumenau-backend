import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());

vi.mock("@/core/db/shared", () => ({ default: execute }));

import { Model } from "./model.js";
import { SoftDeleteSolution } from "./soft-delete-solution.js";

interface SoftRecord {
  id: string;
  name: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

beforeEach(() => execute.mockReset());

describe("SoftDeleteSolution do Model", () => {
  it("escopa leitura e update para registros fora da lixeira", async () => {
    const row: SoftRecord = {
      id: "record-1",
      name: "Ativo",
      created_at: new Date("2026-09-07T00:00:00.000Z"),
      updated_at: new Date("2026-09-07T00:00:00.000Z"),
      deleted_at: null,
    };
    execute.mockResolvedValueOnce([row]).mockResolvedValueOnce(true);
    const model = new Model<SoftRecord>("soft_records", {
      deleteSolution: new SoftDeleteSolution<SoftRecord>("deleted_at"),
    });

    await expect(model.find({ id: row.id })).resolves.toEqual(row);
    await expect(model.update({ name: "Novo" }, { id: row.id })).resolves.toBe(true);

    const read = execute.mock.calls[0]?.[0] as SqlStatement;
    const update = execute.mock.calls[1]?.[0] as SqlStatement;
    expect(read.text).toContain("deleted_at IS NULL");
    expect(read.values).toEqual([row.id, 1]);
    expect(update.text).toContain("deleted_at IS NULL");
    expect(update.values).toEqual(["Novo", row.id]);
  });

  it("troca o DELETE físico por timestamp do banco e mantém a guarda idempotente", async () => {
    execute.mockResolvedValueOnce(true);
    const model = new Model<SoftRecord>("soft_records", {
      deleteSolution: new SoftDeleteSolution<SoftRecord>("deleted_at"),
    });

    await expect(model.delete({ id: "record-1" })).resolves.toBe(true);

    const statement = execute.mock.calls[0]?.[0] as SqlStatement;
    expect(statement.text).toContain("UPDATE soft_records");
    expect(statement.text).toContain("deleted_at = CURRENT_TIMESTAMP");
    expect(statement.text).toContain("updated_at = CURRENT_TIMESTAMP");
    expect(statement.text).toContain("deleted_at IS NULL");
    expect(statement.values).toEqual(["record-1"]);
  });

  it("preserva DELETE físico como solução padrão dos demais models", async () => {
    execute.mockResolvedValueOnce(true);
    const model = new Model<SoftRecord>("hard_records");

    await model.delete({ id: "record-1" });

    const statement = execute.mock.calls[0]?.[0] as SqlStatement;
    expect(statement.text).toContain("DELETE FROM hard_records");
    expect(statement.text).not.toContain("deleted_at");
  });
});
