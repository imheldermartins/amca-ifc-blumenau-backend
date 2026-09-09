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
    rqlite.mockResolvedValueOnce([true, true, true, true]);

    await expect(
      authOnboardingStore.createPrivateWorkspace(baseProvision),
    ).resolves.toBe(true);

    const [statements, endpoint, options] = rqlite.mock.calls[0]!;
    expect(endpoint).toBe("execute");
    expect(options).toEqual({ transaction: true });
    expect(statements).toHaveLength(4);
    expect(statements[0][0]).toContain("INSERT INTO users");
    expect(statements[1][0]).toContain("INSERT INTO workspaces");
    expect(statements[1][0]).toContain("organization_id");
    expect(statements[2][0]).toContain("INSERT INTO pages");
    expect(statements[3][0]).toContain("'superadmin'");
    expect(statements[2].slice(1)).toContain(baseProvision.workspaceId);
    expect(statements[3].slice(1)).toEqual([
      baseProvision.membershipId,
      baseProvision.workspaceId,
      baseProvision.userId,
      baseProvision.workspaceId,
    ]);
  });

  it("cria usuário e workspace e consome a chave sem reescrever o destinatário", async () => {
    rqlite.mockResolvedValueOnce([true, true, true, true, true, true]);

    await expect(authOnboardingStore.createWorkspaceWithKey({
      ...baseProvision,
      userName: "Helder Editado",
      userEmail: "novo@ifc.edu.br",
      keyId: "01KXDN4B182DJGAKPX0940H55B",
      keyHash: "a".repeat(64),
      keyAlgorithm: "sha256-v1",
      keyLinkId: "01KXDN4B182DJGAKPX0940H55C",
    })).resolves.toBe(true);

    const [statements, endpoint, options] = rqlite.mock.calls[0]!;
    expect(endpoint).toBe("execute");
    expect(options).toEqual({ transaction: true });
    expect(statements).toHaveLength(6);
    expect(statements.every(([sql]: [string]) => (
      !sql.includes("UPDATE workspace_access_keys")
      || !sql.includes("issued_to_name") && !sql.includes("issued_to_email")
    ))).toBe(true);
    expect(statements[0].slice(1, 5)).toEqual([
      baseProvision.userId,
      "Helder Editado",
      "novo@ifc.edu.br",
      baseProvision.passwordHash,
    ]);
    expect(statements[4][0]).toContain("workspace_access_key_links");
    expect(statements[5][0]).toContain("consumed_by_user_id = ?");
    expect(statements[5][0]).toContain("consumed_as_name = ?");
    expect(statements[5][0]).toContain("consumed_as_email = ?");
    expect(statements[5].slice(1)).toEqual([
      baseProvision.userId,
      "Helder Editado",
      "novo@ifc.edu.br",
      "01KXDN4B182DJGAKPX0940H55B",
      "a".repeat(64),
      "sha256-v1",
      baseProvision.workspaceId,
    ]);
  });

  it("só confirma sucesso quando todas as etapas foram gravadas", async () => {
    rqlite.mockResolvedValueOnce([false, false, false, false, false, false]);

    await expect(authOnboardingStore.createWorkspaceWithKey({
      ...baseProvision,
      keyId: "key",
      keyHash: "hash",
      keyAlgorithm: "sha256-v1",
      keyLinkId: "link",
    })).resolves.toBe(false);
  });
});
