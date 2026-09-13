import { beforeEach, describe, expect, it, vi } from "vitest";

const doubles = vi.hoisted(() => ({
  rqlite: vi.fn(),
  findMembership: vi.fn(),
}));

vi.mock("@db/shared", () => ({ rqlite: doubles.rqlite }));
vi.mock("@models/index", () => ({
  default: { workspaceMembers: { find: doubles.findMembership } },
}));

import workspaceStore from "./workspace-store.js";

beforeEach(() => {
  doubles.rqlite.mockReset();
  doubles.findMembership.mockReset();
});
describe("WorkspaceStore.updateMemberRole", () => {
  it("protege o owner e limita a delegação na mesma transação", async () => {
    doubles.rqlite.mockResolvedValueOnce([false]);

    await expect(
      workspaceStore.updateMemberRole("workspace", "actor", "user", "member"),
    ).resolves.toBe(false);

    const [statements, endpoint, options] = doubles.rqlite.mock.calls[0]!;
    expect(endpoint).toBe("execute");
    expect(options).toEqual({ transaction: true });
    expect(statements).toHaveLength(1);
    expect(statements[0][0]).toContain("candidate.roles");
    expect(statements[0][0]).toContain("NOT EXISTS");
    expect(statements[0]).toContain("promote_members");
    expect(statements[0].slice(1,4)).toEqual(["member", "workspace", "user"]);
  });

  it("retorna sucesso apenas quando a linha foi atualizada", async () => {
    doubles.rqlite.mockResolvedValueOnce([true]);

    await expect(
      workspaceStore.updateMemberRole("workspace", "actor", "user", "superadmin"),
    ).resolves.toBe(true);
  });
});
