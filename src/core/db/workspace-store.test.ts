import { beforeEach, describe, expect, it, vi } from "vitest";

const doubles = vi.hoisted(() => ({
  rqlite: vi.fn(),
  findMembership: vi.fn(),
  getAccess: vi.fn(),
}));

vi.mock("@db/shared", () => ({ rqlite: doubles.rqlite }));
vi.mock("@models/index", () => ({
  default: { workspaceMembers: { find: doubles.findMembership } },
}));
vi.mock("./scoped-access-store.js", async (original) => ({
  ...await original<typeof import('./scoped-access-store.js')>(),
  default: { get: doubles.getAccess },
}));

import workspaceStore from "./workspace-store.js";

beforeEach(() => {
  doubles.rqlite.mockReset();
  doubles.findMembership.mockReset();
  doubles.getAccess.mockReset();
});
describe("WorkspaceStore.listForUser", () => {
  it("ordena a área pessoal primeiro", async () => {
    doubles.rqlite.mockResolvedValueOnce([[]]);
    await expect(workspaceStore.listForUser("user")).resolves.toEqual([]);
    expect(doubles.rqlite.mock.calls[0]?.[0]?.[0]?.[0]).toContain(
      "CASE WHEN w.organization_id IS NULL THEN 0 ELSE 1 END",
    );
  });
});
describe("WorkspaceStore.getForUser", () => {
  it("mantém workspaces legadas sem criador cadastrado na listagem", async () => {
    doubles.getAccess.mockResolvedValueOnce({ permissions: { read: ["view"], write: [] }, roleId: null });
    doubles.rqlite.mockResolvedValueOnce([[{
      id: "workspace", name: "Legada", data: "{}", organization_id: null,
      organization_name: null, page_root_id: "workspace", icon: null,
      created_by_user_id: null, owner_user_id: null, owner_name: null,
      owner_email: null,
    }]]);

    const workspace = await workspaceStore.getForUser("workspace", "user");
    expect(workspace?.owner).toEqual({ id: null, name: null, email: null });
    expect(doubles.rqlite.mock.calls[0]?.[0]?.[0]?.[0]).toContain("LEFT JOIN users owner");
  });
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
