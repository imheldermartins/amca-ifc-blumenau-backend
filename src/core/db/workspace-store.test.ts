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
  it("protege o último superadmin no mesmo statement transacional", async () => {
    doubles.rqlite.mockResolvedValueOnce([false]);

    await expect(
      workspaceStore.updateMemberRole("workspace", "actor", "user", "member"),
    ).resolves.toBe(false);

    const [statements, endpoint, options] = doubles.rqlite.mock.calls[0]!;
    expect(endpoint).toBe("execute");
    expect(options).toEqual({ transaction: true });
    expect(statements).toHaveLength(1);
    expect(statements[0][0]).toContain("SELECT COUNT(*)");
    expect(statements[0][0]).toContain("administrators.role = 'superadmin'");
    expect(statements[0][0]).toContain("actor.role = 'superadmin'");
    expect(statements[0].slice(1)).toEqual([
      "member", "workspace", "user", "actor", "member",
    ]);
  });

  it("retorna sucesso apenas quando a linha foi atualizada", async () => {
    doubles.rqlite.mockResolvedValueOnce([true]);

    await expect(
      workspaceStore.updateMemberRole("workspace", "actor", "user", "superadmin"),
    ).resolves.toBe(true);
  });
});

describe("WorkspaceStore.issueAccessKey", () => {
  it("guarda workspace e vínculo na mesma transação mesmo com FK desativada", async () => {
    doubles.rqlite.mockResolvedValueOnce([true, true]);

    await expect(workspaceStore.issueAccessKey({
      id: "key" as NonEmptyString,
      key_hash: "hash",
      key_hint: "hint",
      algorithm_version: "sha256-v1",
      issued_to_name: "Pessoa",
      issued_to_email: "pessoa@example.com",
      purpose: "join",
      expires_at: "2099-01-01T00:00:00.000Z",
      consumed_at: null,
      consumed_by_user_id: null,
      revoked_at: null,
    }, "workspace", "link")).resolves.toBe(true);

    const [statements, endpoint, options] = doubles.rqlite.mock.calls[0]!;
    expect(endpoint).toBe("execute");
    expect(options).toEqual({ transaction: true });
    expect(statements[0][0]).toContain("FROM workspaces");
    expect(statements[0][0]).toContain("WHERE id = ?");
    expect(statements[1][0]).toContain("FROM workspace_access_keys");
    expect(statements[1].slice(1)).toEqual(["link", "key", "workspace", "key"]);
  });
});
