import { beforeEach, describe, expect, it, vi } from "vitest";

const access = vi.hoisted(() => ({
  canAccessPage: vi.fn(),
}));

vi.mock("@/controllers/page-access-controller", () => ({ default: access }));

import { requirePageAccess } from "./page-access-middleware.js";

const PAGE_ID = "01KXVZ00000000000000000001";
const OWNER_ID = "01KXVZ00000000000000000002";
const COLLABORATOR_ID = "01KXVZ00000000000000000003";
const STRANGER_ID = "01KXVZ00000000000000000004";

beforeEach(() => {
  vi.clearAllMocks();
  access.canAccessPage.mockImplementation(
    async (userId: string) => userId === OWNER_ID || userId === COLLABORATOR_ID,
  );
});

describe("requirePageAccess", () => {
  it.each([
    ["owner", OWNER_ID],
    ["collaborator", COLLABORATOR_ID],
  ])("permite %s no endpoint protegido", async (_role, userId) => {
    const next = vi.fn();
    const response = { status: vi.fn(), json: vi.fn() };

    await requirePageAccess()(
      { params: { id: PAGE_ID }, userId } as never,
      response as never,
      next,
    );

    expect(access.canAccessPage).toHaveBeenCalledWith(userId, PAGE_ID);
    expect(next).toHaveBeenCalledOnce();
    expect(response.status).not.toHaveBeenCalled();
  });

  it("nega estranho como 404 sem executar o endpoint", async () => {
    const next = vi.fn();
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));

    await requirePageAccess()(
      { params: { id: PAGE_ID }, userId: STRANGER_ID } as never,
      { status } as never,
      next,
    );

    expect(access.canAccessPage).toHaveBeenCalledWith(STRANGER_ID, PAGE_ID);
    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({ message: '"Page" não encontrado' });
    expect(next).not.toHaveBeenCalled();
  });
});
