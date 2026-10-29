import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const doubles = vi.hoisted(() => ({
  getAccess: vi.fn(),
  canAccess: vi.fn(),
  getRole: vi.fn(),
  exactEmail: vi.fn(),
  create: vi.fn(),
  getById: vi.fn(),
  ensureDefault: vi.fn(),
  markNotified: vi.fn(),
  beginVerification: vi.fn(),
  send: vi.fn(),
  close: vi.fn(),
}));

vi.mock("@/repositories/access-invite-repository", () => ({
  default: {
    exactEmail: doubles.exactEmail,
    create: doubles.create,
    getById: doubles.getById,
    markNotified: doubles.markNotified,
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
vi.mock("@/services/account-verification", () => ({
  default: { begin: doubles.beginVerification },
}));
vi.mock("@/services/mail/send-email", () => ({
  SendEmail: { fromEnvironment: () => ({ send: doubles.send, close: doubles.close }) },
}));

import { InvitePage } from "@/services/invitations/invite-flow";

const SCOPE_ID = "01KXDN4B182DJGAKPX0940H54N";
const ACTOR_ID = "01KXDN4B182DJGAKPX0940H54P";
const ROLE_ID = "01KXDN4B182DJGAKPX0940H54Q";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("APP_PUBLIC_URL", "");
  vi.stubEnv("NODE_ENV", "development");
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
afterEach(() => vi.unstubAllEnvs());

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

  it.each(["http://localhost:5173", "https://localhost", "http://public.example"])(
    "não persiste convite genérico com origem inválida em produção: %s", async (origin) => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("APP_PUBLIC_URL", origin);
      const result = await new InvitePage().sendInvite({
        scopeId: SCOPE_ID, actorId: ACTOR_ID, roleId: ROLE_ID,
        recipientEmail: null, expiresAt: null, acceptanceLimit: 5,
      });
      expect(result).toEqual({ ok: false, reason: "failed" });
      expect(doubles.create).not.toHaveBeenCalled();
    },
  );

  it("envia outro convite ao mesmo destinatário com a origem configurada", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_PUBLIC_URL", "https://cubsonline.com.br");
    doubles.exactEmail.mockResolvedValue({
      isMember: false, user: { id: "recipient", name: "Ana", verified: true },
    });
    doubles.create.mockResolvedValue(true);
    doubles.getById.mockResolvedValue({
      id: "invite", scopeName: "Página", authorName: "Admin", roleName: "Leitor", expiresAt: null,
    });
    const input = {
      scopeId: SCOPE_ID, actorId: ACTOR_ID, roleId: ROLE_ID,
      recipientEmail: "ana@example.com", expiresAt: null, acceptanceLimit: 1,
    };
    const flow = new InvitePage();
    expect(await flow.sendInvite(input)).toMatchObject({ ok: true, notificationPending: false });
    expect(await flow.sendInvite(input)).toMatchObject({ ok: true, notificationPending: false });
    expect(doubles.send).toHaveBeenCalledTimes(2);
    const links = doubles.send.mock.calls.map(([email]) => {
      expect(email.content.html).not.toContain("localhost");
      return email.content.html.match(/href="([^"]+)"/)[1];
    });
    expect(links[0]).toMatch(/^https:\/\/cubsonline\.com\.br\/pt-br\/invite\/cubs_invite_v1_/);
    expect(links[1]).not.toBe(links[0]);
    expect(doubles.close).toHaveBeenCalledTimes(2);
  });
});
