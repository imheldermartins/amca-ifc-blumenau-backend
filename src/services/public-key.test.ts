import { describe, expect, it } from "vitest";

import {
  allocateDuplicateLabel,
  allocatePublicKey,
  normalizePublicKey,
  reconcilePublicKeyMetadata,
  reconcilePublicKeyScope,
} from "./public-key.js";

describe("public keys", () => {
  it("normaliza NFKD, acentos, espacos e pontuacao", () => {
    expect(normalizePublicKey(" Área de Atuação! ", "coluna")).toBe("area_de_atuacao");
    expect(normalizePublicKey("---", "opcao")).toBe("opcao");
  });

  it("usa o menor sufixo livre", () => {
    expect(allocatePublicKey("status", new Set(["status", "status_2", "status_4"]))).toBe(
      "status_3",
    );
  });

  it("preserva a key em label equivalente e cria alias no rename", () => {
    expect(
      reconcilePublicKeyMetadata("Status", "coluna", { key: "status_2", aliases: [] }),
    ).toEqual({ key: "status_2", aliases: [] });

    expect(
      reconcilePublicKeyMetadata("Situação", "coluna", {
        key: "status",
        aliases: ["estado"],
      }, new Set(), { forceRename: true }),
    ).toEqual({ key: "situacao", aliases: ["estado", "status"] });

    expect(
      reconcilePublicKeyMetadata(
        "Status",
        "coluna",
        { key: "status_2", aliases: [] },
        new Set(),
        { forceRename: true },
      ),
    ).toEqual({ key: "status", aliases: ["status_2"] });
  });

  it("promove um alias da própria entidade ao renomear de volta", () => {
    expect(
      reconcilePublicKeyMetadata(
        "Status",
        "coluna",
        { key: "situacao", aliases: ["status", "estado"] },
        new Set(),
        { forceRename: true },
      ),
    ).toEqual({ key: "status", aliases: ["estado", "situacao"] });
  });

  it("reserva aliases e diferencia duplicatas deterministicamente", () => {
    const result = reconcilePublicKeyScope(
      [
        { id: "a", label: "Status", publicKey: { key: "estado", aliases: ["status"] } },
        { id: "b", label: "Status" },
        { id: "c", label: "Status" },
      ],
      "coluna",
    );

    expect(result.get("a")).toEqual({ key: "estado", aliases: ["status"] });
    expect(result.get("b")?.key).toBe("status_2");
    expect(result.get("c")?.key).toBe("status_3");
  });

  it("não reutiliza keys reservadas fora do escopo ativo", () => {
    const result = reconcilePublicKeyScope(
      [{ id: "nova", label: "Status" }],
      "coluna",
      new Set(["status", "status_2"]),
    );

    expect(result.get("nova")).toEqual({ key: "status_3", aliases: [] });
  });

  it("adiciona sufixo visual somente para entidade nova", () => {
    expect(allocateDuplicateLabel("Status", ["Status", "Status (2)"])).toBe("Status (3)");
    expect(allocateDuplicateLabel("Status", ["Status"], 1)).toBe("Status (1)");
    expect(allocateDuplicateLabel("Status", ["Status", "Status (1)"], 1)).toBe("Status (2)");
    expect(allocateDuplicateLabel("Outro", ["Status"])).toBe("Outro");
  });

  it("repara metadata duplicada sem conservar alias ambiguo", () => {
    const result = reconcilePublicKeyScope(
      [
        { id: "a", label: "Status", publicKey: { key: "status", aliases: [] } },
        { id: "b", label: "Status", publicKey: { key: "status", aliases: [] } },
      ],
      "coluna",
    );

    expect(result.get("a")).toEqual({ key: "status", aliases: [] });
    expect(result.get("b")).toEqual({ key: "status_2", aliases: [] });
  });
});
