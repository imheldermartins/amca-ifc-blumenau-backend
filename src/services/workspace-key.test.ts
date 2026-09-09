import { describe, expect, it } from "vitest";
import {
  WORKSPACE_KEY_ALGORITHM,
  createWorkspaceKey,
  hashWorkspaceKey,
  isWorkspaceKey,
  normalizeWorkspaceEmail,
  normalizeWorkspaceName,
  workspaceKeyExpiresAt,
  workspaceKeyHint,
} from "./workspace-key.js";

describe("workspace key v1", () => {
  it("gera segredo versionado e não determinístico com hash estável", () => {
    const first = createWorkspaceKey();
    const second = createWorkspaceKey();

    expect(WORKSPACE_KEY_ALGORITHM).toBe("sha256-v1");
    expect(isWorkspaceKey(first)).toBe(true);
    expect(first).not.toBe(second);
    expect(hashWorkspaceKey(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashWorkspaceKey(first)).toBe(hashWorkspaceKey(first));
    expect(workspaceKeyHint(first)).not.toContain(first.slice(0, -6));
  });

  it("rejeita formatos que não pertencem ao algoritmo", () => {
    expect(isWorkspaceKey("qualquer-chave")).toBe(false);
    expect(isWorkspaceKey("cubs_ws_v1_curta")).toBe(false);
    expect(isWorkspaceKey(null)).toBe(false);
  });

  it("normaliza as credenciais e expira em sete dias", () => {
    expect(normalizeWorkspaceEmail("  User@IFC.EDU.BR ")).toBe("user@ifc.edu.br");
    expect(normalizeWorkspaceName("  João   DA Silva ")).toBe("joão da silva");
    expect(workspaceKeyExpiresAt(new Date("2026-09-01T12:00:00.000Z")))
      .toBe("2026-09-08T12:00:00.000Z");
  });
});
