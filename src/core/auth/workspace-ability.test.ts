import { describe, expect, it } from "vitest";
import { defineWorkspaceAbility } from "./workspace-ability.js";

describe("workspace ability", () => {
  it("permite ao superadmin gerenciar painel e membros", () => {
    const ability = defineWorkspaceAbility("superadmin");
    expect(ability.can("read", "WorkspaceRoot")).toBe(true);
    expect(ability.can("manage", "WorkspaceSettings")).toBe(true);
    expect(ability.can("manage", "WorkspaceMembers")).toBe(true);
  });

  it("limita member ao workspace e à própria entrada", () => {
    const ability = defineWorkspaceAbility("member");
    expect(ability.can("read", "Workspace")).toBe(true);
    expect(ability.can("read", "WorkspaceRoot")).toBe(true);
    expect(ability.can("manage", "WorkspaceSettings")).toBe(false);
    expect(ability.can("manage", "WorkspaceMembers")).toBe(false);
  });

  it("falha fechado para role ausente", () => {
    expect(defineWorkspaceAbility(null).can("read", "Workspace")).toBe(false);
  });
});
