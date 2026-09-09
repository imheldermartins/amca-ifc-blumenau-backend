import { beforeEach, describe, expect, it, vi } from "vitest";

const doubles = vi.hoisted(() => ({
  sqlRaw: vi.fn(),
  findPage: vi.fn(),
  findUser: vi.fn(),
  findLink: vi.fn(),
  createLink: vi.fn(),
  deleteLink: vi.fn(),
  getWorkspaceMembership: vi.fn(),
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
vi.mock("@db/workspace-store", () => ({
  default: { getMembership: doubles.getWorkspaceMembership },
}));

import pageCollaboratorController from "./page-collaborator-controller.js";

const PAGE_ID = "01KXDN4B182DJGAKPX0940H54N";
const OWNER_ID = "01KXDN4AXN6QJBTZTCWP1JWVW4";
const USER_ID = "01KXDN4B182DJGAKPX0940H54P";
const WORKSPACE_ID = "01KXDN4B182DJGAKPX0940H54Q";

beforeEach(() => vi.clearAllMocks());

describe("PageCollaboratorController", () => {
  it("busca candidatos somente entre os membros da workspace atual", async () => {
    doubles.sqlRaw
      .mockResolvedValueOnce([{ workspace_id: WORKSPACE_ID }])
      .mockResolvedValueOnce([{ id: USER_ID, name: "Ana", email: "ana@example.com" }]);

    const result = await pageCollaboratorController.listCandidates(PAGE_ID, "Ana");

    expect(result).toEqual({
      ok: true,
      data: [{ id: USER_ID, name: "Ana", email: "ana@example.com" }],
    });
    const candidateStatement = doubles.sqlRaw.mock.calls[1]![0];
    expect(candidateStatement.text).toContain("FROM workspace_members wm");
    expect(candidateStatement.text).toContain("NOT EXISTS");
    expect(candidateStatement.text).toContain("LIKE ? ESCAPE");
    expect(candidateStatement.values).toEqual([
      PAGE_ID,
      WORKSPACE_ID,
      "%ana%",
      "%ana%",
      "ana%",
      "ana%",
    ]);
  });

  it("recusa adicionar à página quem não faz parte da workspace", async () => {
    doubles.findPage.mockResolvedValueOnce({ id: PAGE_ID, owner_id: OWNER_ID });
    doubles.sqlRaw.mockResolvedValueOnce([{ workspace_id: WORKSPACE_ID }]);
    doubles.findUser.mockResolvedValueOnce({ id: USER_ID });
    doubles.getWorkspaceMembership.mockResolvedValueOnce(null);

    const result = await pageCollaboratorController.addCollaborators(PAGE_ID, [USER_ID]);

    expect(result).toEqual({
      ok: false,
      reason: "validation",
      message: `Usuário "${USER_ID}" não pertence à workspace atual`,
    });
    expect(doubles.createLink).not.toHaveBeenCalled();
  });
});
