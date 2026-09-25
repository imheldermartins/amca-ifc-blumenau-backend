import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InviteRecord } from "@/db/repositories/access-invite-store";
import { createOpaqueToken, hashOpaqueToken } from "@/services/opaque-token";
import { InviteTokenService } from "@/services/invitations/invite-token-service";
import type { InviteTokenStore } from "@/services/invitations/types/invite-token-service.types";

const token = createOpaqueToken("cubs_invite_v1_");
const invite: InviteRecord = {
  id: "01KXDN4AXN6QJBTZTCWP1JWVW4",
  scopeType: "workspace",
  scopeId: "01KXDN4AXN6QJBTZTCWP1JWVW5",
  scopeName: "Workspace IFC",
  roleId: "01KXDN4AXN6QJBTZTCWP1JWVW6",
  roleName: "Membro",
  recipientEmail: "helder@ifc.estudantes.edu.br",
  authorId: "01KXDN4AXN6QJBTZTCWP1JWVW7",
  authorName: "Admin",
  status: "pending",
  expiresAt: "2026-09-21T12:00:00.000Z",
  acceptanceLimit: 1,
  acceptanceCount: 0,
  notifiedAt: null,
  createdAt: "2026-09-20T12:00:00.000Z",
};

const store = {
  getById: vi.fn(),
  getByTokenHash: vi.fn(),
  acceptById: vi.fn(),
} satisfies InviteTokenStore;

const service = new InviteTokenService(store);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("InviteTokenService", () => {
  it("expõe somente o contexto público de um convite pendente", async () => {
    store.getByTokenHash.mockResolvedValueOnce(invite);

    await expect(service.preview(token)).resolves.toEqual({
      valid: true,
      scopeType: "workspace",
      scopeId: invite.scopeId,
      scopeName: "Workspace IFC",
      roleName: "Membro",
      authorName: "Admin",
      recipientEmail: "helder@ifc.estudantes.edu.br",
      expiresAt: invite.expiresAt,
      acceptanceLimit: 1,
      acceptanceCount: 0,
    });
    expect(store.getByTokenHash).toHaveBeenCalledWith(hashOpaqueToken(token));
  });

  it("não consulta o banco quando o token não tem o formato esperado", async () => {
    await expect(service.preview("token-invalido")).resolves.toEqual({ valid: false });
    await expect(service.accept("token-invalido", invite.authorId)).resolves.toBe(false);
    expect(store.getByTokenHash).not.toHaveBeenCalled();
  });

  it("resolve para cadastro apenas convite pendente compatível com o e-mail", async () => {
    store.getByTokenHash.mockResolvedValue(invite);

    await expect(service.resolveForRegistration(
      token,
      " HELDER@IFC.ESTUDANTES.EDU.BR ",
    )).resolves.toEqual({ valid: true, inviteId: invite.id });
    await expect(service.resolveForRegistration(
      token,
      "outro@ifc.estudantes.edu.br",
    )).resolves.toEqual({ valid: false });
  });

  it("aceita pelo token usando o id já resolvido", async () => {
    store.getByTokenHash.mockResolvedValueOnce(invite);
    store.acceptById.mockResolvedValueOnce(true);

    await expect(service.accept(token, invite.authorId)).resolves.toBe(true);
    expect(store.acceptById).toHaveBeenCalledWith(invite.id, invite.authorId);
  });

  it("aceita pelo id e converte falha de persistência em false", async () => {
    store.acceptById
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error("rqlite indisponível"));

    await expect(service.acceptById(invite.id, invite.authorId)).resolves.toBe(true);
    await expect(service.acceptById(invite.id, invite.authorId)).resolves.toBe(false);
  });

  it("fornece o contexto do convite salvo no onboarding sem expor o registro", async () => {
    store.getById.mockResolvedValueOnce(invite);

    await expect(service.previewById(invite.id)).resolves.toEqual({
      scopeType: "workspace",
      scopeId: invite.scopeId,
      scopeName: "Workspace IFC",
      roleName: "Membro",
      authorName: "Admin",
    });
  });
});
