import { beforeEach, describe, expect, it, vi } from "vitest";

const doubles = vi.hoisted(() => ({
  usersFind: vi.fn(),
  createInOrganization: vi.fn(),
  getForUser: vi.fn(),
  getWorkspaceMembership: vi.fn(),
  updateMemberRole: vi.fn(),
  listMembers: vi.fn(),
  can: vi.fn(),
}));

vi.mock("@models/index", () => ({
  default: { users: { find: doubles.usersFind } },
}));
vi.mock("@db/workspace-store", () => ({
  default: {
    createInOrganization: doubles.createInOrganization,
    getForUser: doubles.getForUser,
    getMembership: doubles.getWorkspaceMembership,
    updateMemberRole: doubles.updateMemberRole,
    listMembers: doubles.listMembers,
  },
}));
vi.mock("@db/scoped-access-store", async (load) => ({ ...await load<object>(), default: { can: doubles.can } }));

import workspacesController from "./workspaces-controller.js";

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
});

describe("WorkspacesController.createInOrganization", () => {
  it("exige organização para criar uma workspace adicional", async () => {
    await expect(workspacesController.createInOrganization(USER_ID, {
      name: "Outra",
    })).resolves.toEqual({
      ok: false,
      reason: "validation",
      message: "Escolha uma organização para criar a workspace",
    });
    expect(doubles.createInOrganization).not.toHaveBeenCalled();
  });

  it("não permite que member crie workspace na organização", async () => {
    doubles.can.mockResolvedValueOnce(false);

    await expect(workspacesController.createInOrganization(USER_ID, {
      name: "Campus",
      organizationId: ORGANIZATION_ID,
    })).resolves.toEqual({ ok: false, reason: "forbidden", message: "Acesso não permitido" });
    expect(doubles.createInOrganization).not.toHaveBeenCalled();
  });

  it("cria workspace vinculada quando o usuário tem permissão na organização", async () => {
    doubles.can.mockResolvedValueOnce(true);
    doubles.createInOrganization.mockResolvedValueOnce(true);
    doubles.getForUser.mockResolvedValueOnce({ id: WORKSPACE_ID, role: "superadmin" });

    const result = await workspacesController.createInOrganization(USER_ID, {
      name: "Campus",
      organizationId: ORGANIZATION_ID,
    });

    expect(result).toEqual({ ok: true, data: { id: WORKSPACE_ID, role: "superadmin" } });
    expect(doubles.createInOrganization).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: ORGANIZATION_ID,
      ownerId: USER_ID,
      workspaceName: "Campus",
    }));
  });
});

describe("WorkspacesController.updateMemberRole", () => {
  it("recusa enums antigos sem executar a atribuição", async () => {
    expect(await workspacesController.updateMemberRole(WORKSPACE_ID, USER_ID, USER_ID, "superadmin")).toMatchObject({ok:false,reason:"validation"});
    expect(doubles.updateMemberRole).not.toHaveBeenCalled();
  });
  it("respeita a decisão transacional de promoção e proteção do owner", async () => {
    doubles.updateMemberRole.mockResolvedValueOnce(false);
    expect(await workspacesController.updateMemberRole(WORKSPACE_ID, USER_ID, USER_ID, ORGANIZATION_ID)).toMatchObject({ok:false,reason:"forbidden"});
    expect(doubles.listMembers).not.toHaveBeenCalled();
  });
});
