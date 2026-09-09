import { beforeEach, describe, expect, it, vi } from "vitest";

const doubles = vi.hoisted(() => ({
  usersFind: vi.fn(),
  getAccessKey: vi.fn(),
  hasCreatedWorkspace: vi.fn(),
  createWithKey: vi.fn(),
  getForUser: vi.fn(),
  getWorkspaceMembership: vi.fn(),
  updateMemberRole: vi.fn(),
  listMembers: vi.fn(),
  getOrganizationMembership: vi.fn(),
}));

vi.mock("@models/index", () => ({
  default: { users: { find: doubles.usersFind } },
}));
vi.mock("@db/workspace-store", () => ({
  default: {
    getAccessKey: doubles.getAccessKey,
    hasCreatedWorkspace: doubles.hasCreatedWorkspace,
    createWithKey: doubles.createWithKey,
    getForUser: doubles.getForUser,
    getMembership: doubles.getWorkspaceMembership,
    updateMemberRole: doubles.updateMemberRole,
    listMembers: doubles.listMembers,
  },
}));
vi.mock("@db/organization-store", () => ({
  default: { getMembership: doubles.getOrganizationMembership },
}));

import workspacesController from "./workspaces-controller.js";

const RAW_KEY = `cubs_ws_v1_${"A".repeat(32)}`;
const USER_ID = "01KXDN4AXN6QJBTZTCWP1JWVW4";
const WORKSPACE_ID = "01KXDN4B182DJGAKPX0940H54N";
const ORGANIZATION_ID = "01KXDN4B182DJGAKPX0940H55A";

beforeEach(() => {
  vi.clearAllMocks();
  doubles.usersFind.mockResolvedValue({
    id: USER_ID,
    name: "Helder",
    email: "helder@example.com",
  });
  doubles.getAccessKey.mockResolvedValue({
    id: "01KXDN4B182DJGAKPX0940H56B",
    key_hash: "hash",
    algorithm_version: "sha256-v1",
    issued_to_name: "Helder",
    issued_to_email: "helder@example.com",
    purpose: "create",
    expires_at: "2099-01-01T00:00:00.000Z",
    consumed_at: null,
    revoked_at: null,
    workspace_id: null,
  });
});

describe("WorkspacesController.createWithKey", () => {
  it("impede uma segunda workspace individual", async () => {
    doubles.hasCreatedWorkspace.mockResolvedValueOnce(true);

    await expect(workspacesController.createWithKey(USER_ID, {
      name: "Outra",
      key: RAW_KEY,
    })).resolves.toEqual({
      ok: false,
      reason: "conflict",
      message: "Workspaces adicionais precisam pertencer a uma organização",
    });
    expect(doubles.createWithKey).not.toHaveBeenCalled();
  });

  it("não permite que member crie workspace na organização", async () => {
    doubles.getOrganizationMembership.mockResolvedValueOnce({ role: "member" });

    await expect(workspacesController.createWithKey(USER_ID, {
      name: "Campus",
      key: RAW_KEY,
      organizationId: ORGANIZATION_ID,
    })).resolves.toEqual({ ok: false, reason: "forbidden", message: "Acesso não permitido" });
    expect(doubles.createWithKey).not.toHaveBeenCalled();
  });

  it("cria workspace vinculada quando o usuário é superadmin da organização", async () => {
    doubles.getOrganizationMembership.mockResolvedValueOnce({ role: "superadmin" });
    doubles.createWithKey.mockResolvedValueOnce(true);
    doubles.getForUser.mockResolvedValueOnce({ id: WORKSPACE_ID, role: "superadmin" });

    const result = await workspacesController.createWithKey(USER_ID, {
      name: "Campus",
      key: RAW_KEY,
      organizationId: ORGANIZATION_ID,
    });

    expect(result).toEqual({ ok: true, data: { id: WORKSPACE_ID, role: "superadmin" } });
    expect(doubles.createWithKey).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: ORGANIZATION_ID,
      ownerId: USER_ID,
      workspaceName: "Campus",
    }));
  });
});

describe("WorkspacesController.updateMemberRole", () => {
  it("impede member de promover a si mesmo mesmo fora do middleware HTTP", async () => {
    doubles.getWorkspaceMembership
      .mockResolvedValueOnce({ role: "member" })
      .mockResolvedValueOnce({ role: "member" });

    await expect(workspacesController.updateMemberRole(
      WORKSPACE_ID,
      USER_ID,
      USER_ID,
      "superadmin",
    )).resolves.toEqual({ ok: false, reason: "forbidden", message: "Acesso não permitido" });
    expect(doubles.updateMemberRole).not.toHaveBeenCalled();
  });

  it("não permite rebaixar o último superadmin", async () => {
    doubles.getWorkspaceMembership
      .mockResolvedValueOnce({ role: "superadmin" })
      .mockResolvedValueOnce({ role: "superadmin" });
    doubles.updateMemberRole.mockResolvedValueOnce(false);

    await expect(workspacesController.updateMemberRole(
      WORKSPACE_ID,
      USER_ID,
      USER_ID,
      "member",
    )).resolves.toEqual({
      ok: false,
      reason: "conflict",
      message: "A workspace precisa manter ao menos um superadmin",
    });
  });
});
