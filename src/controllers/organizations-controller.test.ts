import { beforeEach, describe, expect, it, vi } from "vitest";

const doubles = vi.hoisted(() => ({
  listOrganizations: vi.fn(),
  getOrganizationMembership: vi.fn(),
  createWithWorkspace: vi.fn(),
  linkWorkspace: vi.fn(),
  searchWorkspaceUsers: vi.fn(),
  getWorkspaceUser: vi.fn(),
  addWorkspaceUser: vi.fn(),
  getWorkspace: vi.fn(),
}));

vi.mock("@db/organization-store", () => ({
  default: {
    listForUser: doubles.listOrganizations,
    getMembership: doubles.getOrganizationMembership,
    createWithWorkspace: doubles.createWithWorkspace,
    linkWorkspace: doubles.linkWorkspace,
    searchWorkspaceUsers: doubles.searchWorkspaceUsers,
    getWorkspaceUser: doubles.getWorkspaceUser,
    addWorkspaceUser: doubles.addWorkspaceUser,
  },
}));
vi.mock("@db/workspace-store", () => ({
  default: { getForUser: doubles.getWorkspace },
}));

import organizationsController from "./organizations-controller.js";

const USER_ID = "01KXDN4AXN6QJBTZTCWP1JWVW4";
const WORKSPACE_ID = "01KXDN4B182DJGAKPX0940H54N";
const ORGANIZATION_ID = "01KXDN4B182DJGAKPX0940H55A";

const workspace = {
  id: WORKSPACE_ID,
  name: "IFC Blumenau",
  data: {},
  organizationId: null,
  organizationName: null,
  icon: "lucide:boxes",
  createdByUserId: USER_ID,
  role: "superadmin" as const,
  pageRootId: WORKSPACE_ID,
};

beforeEach(() => vi.clearAllMocks());

describe("OrganizationsController", () => {
  it("não permite que member crie uma organização a partir da workspace", async () => {
    doubles.getWorkspace.mockResolvedValueOnce({ ...workspace, role: "member" });

    await expect(organizationsController.create(USER_ID, {
      name: "IFC",
      workspaceId: WORKSPACE_ID,
    })).resolves.toEqual({ ok: false, reason: "forbidden", message: "Acesso não permitido" });

    expect(doubles.createWithWorkspace).not.toHaveBeenCalled();
  });

  it("cria a organização, vincula a primeira workspace e retorna o resumo", async () => {
    doubles.getWorkspace.mockResolvedValueOnce(workspace);
    doubles.createWithWorkspace.mockResolvedValueOnce(true);
    doubles.listOrganizations.mockImplementationOnce(async () => [{
      id: doubles.createWithWorkspace.mock.calls[0]![0].organizationId,
      name: "IFC",
      data: {},
      role: "superadmin",
      workspaceCount: 1,
    }]);

    const result = await organizationsController.create(USER_ID, {
      name: "IFC",
      workspaceId: WORKSPACE_ID,
    });

    expect(result.ok).toBe(true);
    expect(doubles.createWithWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      organizationName: "IFC",
      ownerId: USER_ID,
      workspaceId: WORKSPACE_ID,
    }));
  });

  it("exige superadmin da organização e da workspace para criar o vínculo", async () => {
    doubles.getOrganizationMembership.mockResolvedValueOnce({ role: "member" });
    doubles.getWorkspace.mockResolvedValueOnce(workspace);

    await expect(organizationsController.linkWorkspace(
      ORGANIZATION_ID,
      WORKSPACE_ID,
      USER_ID,
    )).resolves.toEqual({ ok: false, reason: "forbidden", message: "Acesso não permitido" });

    expect(doubles.linkWorkspace).not.toHaveBeenCalled();
  });

  it("busca usuários com prefixo antes de ocorrência e escapa wildcards", async () => {
    doubles.getOrganizationMembership.mockResolvedValueOnce({ role: "superadmin" });
    doubles.getWorkspace.mockResolvedValueOnce({
      ...workspace,
      organizationId: ORGANIZATION_ID,
    });
    doubles.searchWorkspaceUsers.mockResolvedValueOnce([]);

    const result = await organizationsController.searchWorkspaceUsers(
      ORGANIZATION_ID,
      WORKSPACE_ID,
      USER_ID,
      "Ana%_",
    );

    expect(result).toEqual({ ok: true, data: [] });
    expect(doubles.searchWorkspaceUsers).toHaveBeenCalledWith(
      ORGANIZATION_ID,
      WORKSPACE_ID,
      USER_ID,
      "ana\\%\\_%",
      "%ana\\%\\_%",
    );
  });

  it("não deixa member da organização buscar ou adicionar usuários", async () => {
    doubles.getOrganizationMembership.mockResolvedValueOnce({ role: "member" });
    doubles.getWorkspace.mockResolvedValueOnce({
      ...workspace,
      organizationId: ORGANIZATION_ID,
    });

    await expect(organizationsController.searchWorkspaceUsers(
      ORGANIZATION_ID,
      WORKSPACE_ID,
      USER_ID,
      "",
    )).resolves.toEqual({
      ok: false,
      reason: "forbidden",
      message: "Acesso não permitido",
    });
    expect(doubles.searchWorkspaceUsers).not.toHaveBeenCalled();

    doubles.getOrganizationMembership.mockResolvedValueOnce({ role: "member" });
    doubles.getWorkspace.mockResolvedValueOnce({
      ...workspace,
      organizationId: ORGANIZATION_ID,
    });
    doubles.getWorkspaceUser.mockResolvedValueOnce(null);
    await expect(organizationsController.addWorkspaceUser(
      ORGANIZATION_ID,
      WORKSPACE_ID,
      USER_ID,
      "01KXDN4B182DJGAKPX0940H54P",
    )).resolves.toEqual({
      ok: false,
      reason: "forbidden",
      message: "Acesso não permitido",
    });
    expect(doubles.addWorkspaceUser).not.toHaveBeenCalled();
  });

  it("adiciona o usuário sempre como member da organização e da workspace", async () => {
    doubles.getOrganizationMembership.mockResolvedValueOnce({ role: "superadmin" });
    doubles.getWorkspace.mockResolvedValueOnce({
      ...workspace,
      organizationId: ORGANIZATION_ID,
    });
    doubles.getWorkspaceUser
      .mockResolvedValueOnce({
        id: "01KXDN4B182DJGAKPX0940H54P",
        name: "Ana Silva",
        email: "ana@example.com",
        organizationRole: null,
        workspaceRole: null,
      })
      .mockResolvedValueOnce({
        id: "01KXDN4B182DJGAKPX0940H54P",
        name: "Ana Silva",
        email: "ana@example.com",
        organizationRole: "member",
        workspaceRole: "member",
      });
    doubles.addWorkspaceUser.mockResolvedValueOnce(true);

    const result = await organizationsController.addWorkspaceUser(
      ORGANIZATION_ID,
      WORKSPACE_ID,
      USER_ID,
      "01KXDN4B182DJGAKPX0940H54P",
    );

    expect(result.ok).toBe(true);
    expect(doubles.addWorkspaceUser).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: ORGANIZATION_ID,
      workspaceId: WORKSPACE_ID,
      actorUserId: USER_ID,
      targetUserId: "01KXDN4B182DJGAKPX0940H54P",
      pageRootTitle: "Ana base de dados",
    }));
  });
});
