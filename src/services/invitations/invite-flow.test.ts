import { beforeEach, describe, expect, it, vi } from "vitest";

const doubles = vi.hoisted(() => ({
  getAccess: vi.fn(),
  canAccess: vi.fn(),
  getRole: vi.fn(),
  exactEmail: vi.fn(),
  create: vi.fn(),
  getById: vi.fn(),
  ensureDefault: vi.fn(),
}));

vi.mock("@/repositories/access-invite-repository", () => ({
  default: {
    exactEmail: doubles.exactEmail,
    create: doubles.create,
    getById: doubles.getById,
  },
}));
vi.mock("@/repositories/role-repository", () => ({
  default: { get: doubles.getRole },
}));
vi.mock("@/repositories/scoped-access-repository", () => ({
  default: { get: doubles.getAccess, can: doubles.canAccess },
}));
vi.mock("@/repositories/system-role-factory", () => ({
  SystemRoleFactory: { ensureDefault: doubles.ensureDefault },
}));

import { InvitePage } from "@/services/invitations/invite-flow";

const SCOPE_ID = "01KXDN4B182DJGAKPX0940H54N";
const ACTOR_ID = "01KXDN4B182DJGAKPX0940H54P";
const ROLE_ID = "01KXDN4B182DJGAKPX0940H54Q";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("APP_PUBLIC_URL", "");
  doubles.getAccess.mockResolvedValue({
    ownerId: ACTOR_ID,
    permissions: { read: ["view"], write: ["add_members"] },
  });
  doubles.canAccess.mockResolvedValue(true);
  doubles.getRole.mockResolvedValue({
    id: ROLE_ID,
    roles: { read: ["view"], write: ["add_members"] },
  });
});

describe("InviteFlow", () => {
  it("não persiste convite genérico quando não há URL pública de entrega", async () => {
    const result = await new InvitePage().sendInvite({
      scopeId: SCOPE_ID,
      actorId: ACTOR_ID,
      roleId: ROLE_ID,
      recipientEmail: null,
      expiresAt: null,
      acceptanceLimit: 5,
    });

    expect(result).toEqual({ ok: false, reason: "failed" });
    expect(doubles.create).not.toHaveBeenCalled();
    expect(doubles.getById).not.toHaveBeenCalled();
  });
});
