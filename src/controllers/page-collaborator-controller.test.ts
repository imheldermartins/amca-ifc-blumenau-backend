import { beforeEach, describe, expect, it, vi } from "vitest";

const doubles = vi.hoisted(() => ({
  sqlRaw: vi.fn(),
  findPage: vi.fn(),
  findUser: vi.fn(),
  findLink: vi.fn(),
  createLink: vi.fn(),
  deleteLink: vi.fn(),
  getWorkspaceMembership: vi.fn(),
  removeMember: vi.fn(),
}));

vi.mock("@models/index", () => ({
  default: {
    sqlRaw: doubles.sqlRaw,
    pages: { find: doubles.findPage },
    users: { find: doubles.findUser },
    pageCollaborators: {
      find: doubles.findLink,
      create: doubles.createLink,
      delete: doubles.deleteLink,
    },
  },
}));
vi.mock("@/repositories/workspace-repository", () => ({
  default: { getMembership: doubles.getWorkspaceMembership },
}));
vi.mock("@/repositories/role-repository", () => ({
  default: { removeMember: doubles.removeMember },
}));

import pageCollaboratorController from "./page-collaborator-controller.js";

const PAGE_ID = "01KXDN4B182DJGAKPX0940H54N";
const USER_ID = "01KXDN4B182DJGAKPX0940H54P";
const WORKSPACE_ID = "01KXDN4B182DJGAKPX0940H54Q";

beforeEach(() => vi.clearAllMocks());

describe("PageCollaboratorController", () => {
  it("busca candidatos somente entre os membros da workspace atual", async () => {
    doubles.sqlRaw
      .mockResolvedValueOnce([{ workspace_id: WORKSPACE_ID }])
      .mockResolvedValueOnce([{ id: USER_ID, name: "Ana", email: "ana@example.com" }]);

    const result = await pageCollaboratorController.listCandidates(PAGE_ID, "ana@example.com");

    expect(result).toEqual({
      ok: true,
      data: [{ id: USER_ID, name: "Ana", email: "ana@example.com" }],
    });
    const candidateStatement = doubles.sqlRaw.mock.calls[1]![0];
    expect(candidateStatement.text).toContain("FROM workspace_members wm");
    expect(candidateStatement.text).toContain("NOT EXISTS");
    expect(candidateStatement.text).toContain("lower(trim(u.email)) = ?");
    expect(candidateStatement.values).toEqual([
      PAGE_ID,
      WORKSPACE_ID,
      "ana@example.com",
    ]);
  });


  it("não oferece entrada direta e delega remoção autorizada ao RoleStore", async () => {
    expect('addCollaborators' in pageCollaboratorController).toBe(false);

    doubles.removeMember.mockResolvedValue(false);
    const result = await pageCollaboratorController.removeCollaborator(
      PAGE_ID,
      USER_ID,
      WORKSPACE_ID,
    );

    expect(doubles.removeMember).toHaveBeenCalledWith(
      "page",
      PAGE_ID,
      USER_ID,
      WORKSPACE_ID,
    );
    expect(result).toEqual({
      ok: false,
      reason: "forbidden",
      message: "Acesso não permitido",
    });
  });
});
