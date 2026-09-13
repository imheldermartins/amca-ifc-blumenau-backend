import { beforeEach, describe, expect, it, vi } from "vitest";

const rqlite = vi.hoisted(() => vi.fn());
vi.mock("@db/shared", () => ({ rqlite }));

import authOnboardingStore from "./auth-onboarding-store.js";

const baseProvision = {
  userId: "01KXDN4AXN6QJBTZTCWP1JWVW4",
  userName: "Helder",
  userEmail: "helder@ifc.estudantes.edu.br",
  passwordHash: "bcrypt-hash",
  workspaceId: "01KXDN4B182DJGAKPX0940H54N",
  workspaceName: "Area de Trabalho do Helder",
  workspaceIcon: "lucide:boxes",
  membershipId: "01KXDN4B182DJGAKPX0940H55A",
};

beforeEach(() => rqlite.mockReset());

describe("AuthOnboardingStore", () => {
  it("consulta e-mail pela forma canônica sem expor o hash fora do store", async () => {
    const user = {
      id: baseProvision.userId,
      name: baseProvision.userName,
      email: baseProvision.userEmail,
      password_hash: baseProvision.passwordHash,
      token_version: 0,
    };
    rqlite.mockResolvedValueOnce([[user]]);

    await expect(
      authOnboardingStore.findUserByCanonicalEmail(baseProvision.userEmail),
    ).resolves.toEqual(user);

    const [statements, endpoint] = rqlite.mock.calls[0]!;
    expect(endpoint).toBe("query");
    expect(statements[0][0]).toContain("lower(trim(email)) = ?");
    expect(statements[0][1]).toBe(baseProvision.userEmail);
  });

  it("cria o cadastro comum e a workspace privada na mesma transação", async () => {
    rqlite.mockResolvedValueOnce([true, true, true, true, true, true]);

    await expect(
      authOnboardingStore.createPrivateWorkspace(baseProvision),
    ).resolves.toBe(true);

    const [statements, endpoint, options] = rqlite.mock.calls[0]!;
    expect(endpoint).toBe("execute");
    expect(options).toEqual({ transaction: true });
    expect(statements).toHaveLength(6);
    expect(statements[0][0]).toContain("INSERT INTO users");
    expect(statements[1][0]).toContain("INSERT INTO workspaces");
    expect(statements[1][0]).toContain("organization_id");
    expect(statements[2][0]).toContain("INSERT INTO pages");
    expect(statements[3][0]).toContain("workspace_roles");
    expect(statements[4][0]).toContain("page_roles");
    expect(statements[5][0]).toContain("workspace_member_role_id");
    expect(statements[2].slice(1)).toContain(baseProvision.workspaceId);
    expect(statements[5].slice(1)).toEqual([
      baseProvision.membershipId,
      baseProvision.workspaceId,
      baseProvision.userId,
      baseProvision.workspaceId,
    ]);
  });

});
