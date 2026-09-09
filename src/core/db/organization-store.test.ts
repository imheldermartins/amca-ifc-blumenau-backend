import { beforeEach, describe, expect, it, vi } from "vitest";

const doubles = vi.hoisted(() => ({
  rqlite: vi.fn(),
  findMembership: vi.fn(),
}));

vi.mock("@db/shared", () => ({ rqlite: doubles.rqlite }));
vi.mock("@models/index", () => ({
  default: { organizationMembers: { find: doubles.findMembership } },
}));

import organizationStore from "./organization-store.js";

beforeEach(() => vi.clearAllMocks());

describe("OrganizationStore", () => {
  it("busca todos os usuários com LIKE parametrizado e prioriza prefixo", async () => {
    doubles.rqlite.mockResolvedValueOnce([[]]);

    await organizationStore.searchWorkspaceUsers(
      "organization",
      "workspace",
      "actor",
      "ana%",
      "%ana%",
    );

    const [statements, endpoint] = doubles.rqlite.mock.calls[0]!;
    expect(endpoint).toBe("query");
    expect(statements[0][0]).toContain("LIKE ? ESCAPE");
    expect(statements[0][0]).toContain("THEN 0 ELSE 1");
    expect(statements[0][0]).not.toContain("%ana%");
    expect(statements[0].slice(-4)).toEqual(["%ana%", "%ana%", "ana%", "ana%"]);
  });

  it("cria a organização e vincula apenas uma workspace administrada", async () => {
    doubles.rqlite.mockResolvedValueOnce([true, true, true]);

    await expect(organizationStore.createWithWorkspace({
      organizationId: "organization",
      organizationName: "IFC",
      membershipId: "membership",
      ownerId: "user",
      workspaceId: "workspace",
    })).resolves.toBe(true);

    const [statements, endpoint, options] = doubles.rqlite.mock.calls[0]!;
    expect(endpoint).toBe("execute");
    expect(options).toEqual({ transaction: true });
    expect(statements).toHaveLength(3);
    expect(statements[0][0]).toContain("wm.role = 'superadmin'");
    expect(statements[2][0]).toContain("om.role = 'superadmin'");
    expect(statements[2][0]).toContain("wm.role = 'superadmin'");
  });

  it("vincula outra workspace somente se o usuário administrar os dois lados", async () => {
    doubles.rqlite.mockResolvedValueOnce([true]);

    await expect(
      organizationStore.linkWorkspace("organization", "workspace", "user"),
    ).resolves.toBe(true);

    const [statements] = doubles.rqlite.mock.calls[0]!;
    expect(statements[0][0]).toContain("organization_members");
    expect(statements[0][0]).toContain("workspace_members");
    expect(statements[0][0].match(/role = 'superadmin'/g)).toHaveLength(2);
  });

  it("adiciona member, page-root e membership numa transação autorizada", async () => {
    doubles.rqlite.mockResolvedValueOnce([true, true, true]);

    await expect(organizationStore.addWorkspaceUser({
      organizationId: "organization",
      workspaceId: "workspace",
      actorUserId: "actor",
      targetUserId: "target",
      organizationMembershipId: "organization-membership",
      workspaceMembershipId: "workspace-membership",
      pageRootId: "page-root",
      pageRootTitle: "Ana base de dados",
    })).resolves.toBe(true);

    const [statements, endpoint, options] = doubles.rqlite.mock.calls[0]!;
    expect(endpoint).toBe("execute");
    expect(options).toEqual({ transaction: true });
    expect(statements).toHaveLength(3);
    expect(statements[0][0]).toContain("INSERT INTO organization_members");
    expect(statements[1][0]).toContain("INSERT INTO pages");
    expect(statements[2][0]).toContain("INSERT INTO workspace_members");
    expect(statements.every(([sql]: [string]) => sql.includes("actor_organization"))).toBe(true);
  });
});
