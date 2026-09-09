import { describe, expect, it } from "vitest";
import { isWorkspaceIcon } from "./workspace-icon.js";

describe("isWorkspaceIcon", () => {
  it("aceita somente nomes canônicos dos catálogos Cuida e Lucide", () => {
    expect(isWorkspaceIcon("cuida:building-outline")).toBe(true);
    expect(isWorkspaceIcon("lucide:boxes")).toBe(true);
    expect(isWorkspaceIcon("lucide:graduation-cap")).toBe(true);
  });

  it("rejeita biblioteca, alias sintático ou nome inexistente", () => {
    expect(isWorkspaceIcon("mdi:home")).toBe(false);
    expect(isWorkspaceIcon("cuida:activity")).toBe(false);
    expect(isWorkspaceIcon("lucide:not-a-real-cubs-icon")).toBe(false);
    expect(isWorkspaceIcon("lucide:Boxes")).toBe(false);
  });
});
