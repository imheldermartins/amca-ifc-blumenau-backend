import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScopeAccess } from "@/services/auth/permissions";
import { InviteApplicationService } from "@/services/invitations/invite-application-service";
import type {
  InviteApplicationDependencies,
  InviteAuthorizationPort,
  InviteFlowRegistryPort,
  InviteStorePort,
} from "@/services/invitations/types/invite-application-service.types";

const SCOPE_ID = "01KXDN4B182DJGAKPX0940H54N";
const ACTOR_ID = "01KXDN4B182DJGAKPX0940H54P";
const ROLE_ID = "01KXDN4B182DJGAKPX0940H54Q";
const INVITE_ID = "01KXDN4B182DJGAKPX0940H54R";
const NOW = new Date("2026-09-20T12:00:00.000Z");

const invite = {
  id: INVITE_ID,
  scopeType: "page" as const,
  scopeId: SCOPE_ID,
  scopeName: "Produto",
  roleId: ROLE_ID,
  roleName: "Editor",
  recipientEmail: null,
  authorId: ACTOR_ID,
  authorName: "Admin",
  status: "pending" as const,
  expiresAt: null,
  acceptanceLimit: null,
  acceptanceCount: 0,
  notifiedAt: null,
  createdAt: NOW.toISOString(),
};

const grant = (read: string[] = [], write: string[] = []): ScopeAccess => ({
  scope: "page",
  scopeId: SCOPE_ID,
  ownerId: ACTOR_ID,
  isOwner: true,
  isMember: false,
  roleId: null,
  roleName: null,
  permissions: { read, write },
});

function setup() {
  const authorization: InviteAuthorizationPort = {
    get: vi.fn(),
    can: vi.fn(),
  };
  const store: InviteStorePort = {
    list: vi.fn(),
    exactEmail: vi.fn(),
    remove: vi.fn(),
  };
  const sendInvite = vi.fn<ReturnType<InviteFlowRegistryPort["for"]>["sendInvite"]>();
  const flows: InviteFlowRegistryPort = {
    for: vi.fn(() => ({ sendInvite })),
  };
  const dependencies: InviteApplicationDependencies = {
    authorization,
    store,
    flows,
    now: () => NOW,
  };

  return {
    authorization,
    store,
    sendInvite,
    service: new InviteApplicationService(dependencies),
  };
}

beforeEach(() => vi.clearAllMocks());

describe("InviteApplicationService", () => {
  it("normaliza a criação e calcula expiração e limite", async () => {
    const { service, sendInvite } = setup();
    sendInvite.mockResolvedValue({
      ok: true,
      invite,
      inviteUrl: "https://cubs.example/invite/token",
      notificationPending: false,
    });

    const result = await service.createInvite("page", SCOPE_ID, ACTOR_ID, {
      recipientEmail: "  ANA@EXAMPLE.COM ",
      roleId: ROLE_ID,
      expiresIn: "7d",
      acceptanceLimit: "3",
    });

    expect(result).toMatchObject({ ok: true, data: { invite } });
    expect(sendInvite).toHaveBeenCalledWith({
      scopeId: SCOPE_ID,
      actorId: ACTOR_ID,
      recipientEmail: "ana@example.com",
      roleId: ROLE_ID,
      expiresAt: "2026-09-27T12:00:00.000Z",
      acceptanceLimit: 3,
    });
  });

  it("normaliza inviteMember com validade fixa de 24 horas e um aceite", async () => {
    const { service, sendInvite } = setup();
    sendInvite.mockResolvedValue({
      ok: true,
      invite,
      inviteUrl: null,
      notificationPending: false,
    });

    await service.inviteMember("workspace", SCOPE_ID, ACTOR_ID, {
      email: " NEW@EXAMPLE.COM ",
    });

    expect(sendInvite).toHaveBeenCalledWith({
      scopeId: SCOPE_ID,
      actorId: ACTOR_ID,
      recipientEmail: "new@example.com",
      roleId: undefined,
      expiresAt: "2026-09-21T12:00:00.000Z",
      acceptanceLimit: 1,
    });
  });

  it("rejeita corpos inválidos antes de selecionar o fluxo", async () => {
    const { service, sendInvite } = setup();

    await expect(service.createInvite("page", SCOPE_ID, ACTOR_ID, {
      expiresIn: "tomorrow",
    })).resolves.toEqual({
      ok: false,
      reason: "validation",
      message: "Dados inválidos",
    });
    await expect(service.inviteMember("page", SCOPE_ID, ACTOR_ID, {
      email: "email-inválido",
    })).resolves.toMatchObject({ ok: false, reason: "validation" });
    expect(sendInvite).not.toHaveBeenCalled();
  });

  it("mapeia falha de persistência do fluxo como erro de servidor", async () => {
    const { service, sendInvite } = setup();
    sendInvite.mockResolvedValue({ ok: false, reason: "failed" });

    await expect(service.createInvite("page", SCOPE_ID, ACTOR_ID, {})).resolves.toEqual({
      ok: false,
      reason: "server_error",
      message: "Erro no servidor",
    });
  });

  it("lista convites somente para quem pode ver ou adicionar membros", async () => {
    const { service, authorization, store } = setup();
    vi.mocked(authorization.get)
      .mockResolvedValueOnce(grant(["view", "members"]))
      .mockResolvedValueOnce(grant(["view"]));
    vi.mocked(store.list).mockResolvedValue([invite]);

    await expect(service.list("page", SCOPE_ID, ACTOR_ID)).resolves.toEqual({
      ok: true,
      data: [invite],
    });
    await expect(service.list("page", SCOPE_ID, ACTOR_ID)).resolves.toMatchObject({
      ok: false,
      reason: "forbidden",
    });
    expect(store.list).toHaveBeenCalledOnce();
  });

  it("autoriza e normaliza a busca exata do destinatário", async () => {
    const { service, authorization, store } = setup();
    vi.mocked(authorization.can).mockResolvedValue(true);
    vi.mocked(store.exactEmail).mockResolvedValue({
      found: false,
      user: null,
      isMember: false,
    });

    await expect(service.searchRecipient(
      "organization",
      SCOPE_ID,
      ACTOR_ID,
      "  PERSON@EXAMPLE.COM ",
    )).resolves.toMatchObject({ ok: true });
    expect(store.exactEmail).toHaveBeenCalledWith(
      "person@example.com",
      "organization",
      SCOPE_ID,
    );
  });

  it("valida, autoriza e revoga o convite no escopo correto", async () => {
    const { service, authorization, store } = setup();
    vi.mocked(authorization.can).mockResolvedValue(true);
    vi.mocked(store.remove).mockResolvedValue(true);

    await expect(service.revoke("page", SCOPE_ID, ACTOR_ID, INVITE_ID)).resolves.toEqual({
      ok: true,
      data: { expired: true },
    });
    expect(store.remove).toHaveBeenCalledWith(INVITE_ID, "page", SCOPE_ID);
  });
});
