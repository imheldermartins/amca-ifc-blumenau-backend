import { beforeEach, describe, expect, it, vi } from "vitest";

const doubles = vi.hoisted(() => ({
  usersFind: vi.fn(),
  usersUpdate: vi.fn(),
  hash: vi.fn(),
  compare: vi.fn(),
  issueTokenPair: vi.fn(),
  createPrivateWorkspace: vi.fn(),
  createWorkspaceWithKey: vi.fn(),
  findUserByCanonicalEmail: vi.fn(),
  getAccessKey: vi.fn(),
  getForUser: vi.fn(),
}));

vi.mock("@/core/db/model", () => ({
  Model: class {
    find = doubles.usersFind;
    update = doubles.usersUpdate;
  },
}));
vi.mock("bcryptjs", () => ({
  default: { hash: doubles.hash, compare: doubles.compare },
}));
vi.mock("@core/auth/jwt-service", () => ({
  default: { issueTokenPair: doubles.issueTokenPair },
}));
vi.mock("@db/auth-onboarding-store", () => ({
  default: {
    createPrivateWorkspace: doubles.createPrivateWorkspace,
    createWorkspaceWithKey: doubles.createWorkspaceWithKey,
    findUserByCanonicalEmail: doubles.findUserByCanonicalEmail,
  },
}));
vi.mock("@db/workspace-store", () => ({
  default: {
    getAccessKey: doubles.getAccessKey,
    getForUser: doubles.getForUser,
  },
}));

import authController from "./auth-controller.js";

const RAW_KEY = `cubs_ws_v1_${"A".repeat(32)}`;
const user = {
  id: "01KXDN4AXN6QJBTZTCWP1JWVW4",
  name: "Helder da Silva",
  email: "helder@ifc.estudantes.edu.br",
  password_hash: "bcrypt-hash",
  token_version: 0,
  created_at: new Date(),
  updated_at: new Date(),
};
const workspace = {
  id: "01KXDN4B182DJGAKPX0940H54N",
  name: "Area de Trabalho do Helder",
  data: {},
  organizationId: null,
  organizationName: null,
  icon: "lucide:boxes",
  createdByUserId: user.id,
  role: "superadmin" as const,
  pageRootId: "01KXDN4B182DJGAKPX0940H54N",
};
const keyRecord = {
  id: "01KXDN4B182DJGAKPX0940H55A",
  key_hash: "a".repeat(64),
  key_hint: "cubs_ws_v1_…AAAAAA",
  algorithm_version: "sha256-v1",
  issued_to_name: "Helder",
  issued_to_email: "helder@ifc.estudantes.edu.br",
  purpose: "create" as const,
  expires_at: "2099-01-01T00:00:00.000Z",
  consumed_at: null,
  consumed_by_user_id: null,
  revoked_at: null,
  workspace_id: null,
  workspace_name: null,
  created_at: new Date(),
  updated_at: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  doubles.hash.mockResolvedValue("bcrypt-hash");
  doubles.issueTokenPair.mockReturnValue({
    accessToken: "access-token",
    refreshToken: "refresh-token",
  });
});

describe("AuthController onboarding", () => {
  it("cadastro comum cria a workspace privada com o primeiro nome", async () => {
    doubles.findUserByCanonicalEmail.mockResolvedValueOnce(null);
    doubles.usersFind.mockResolvedValueOnce(user);
    doubles.createPrivateWorkspace.mockResolvedValueOnce(true);
    doubles.getForUser.mockResolvedValueOnce(workspace);

    const result = await authController.register({
      name: "  Helder   da Silva ",
      email: " HELDER@IFC.ESTUDANTES.EDU.BR ",
      password: "segredo",
    });

    expect(result).toMatchObject({ ok: true, workspace, user: {
      id: user.id,
      name: user.name,
      email: user.email,
    } });
    expect(doubles.createPrivateWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      userName: "Helder da Silva",
      userEmail: "helder@ifc.estudantes.edu.br",
      workspaceName: "Area de Trabalho do Helder",
      workspaceIcon: "lucide:boxes",
    }));
    expect(doubles.issueTokenPair).toHaveBeenCalledWith({ sub: user.id }, 0);
  });

  it("preview expõe somente o autocomplete de uma chave create válida", async () => {
    doubles.getAccessKey.mockResolvedValueOnce(keyRecord);

    await expect(authController.previewWorkspaceKey(RAW_KEY)).resolves.toEqual({
      valid: true,
      name: "Helder",
      email: "helder@ifc.estudantes.edu.br",
    });

    doubles.getAccessKey.mockResolvedValueOnce({ ...keyRecord, purpose: "join" });
    await expect(authController.previewWorkspaceKey(RAW_KEY)).resolves.toEqual({ valid: false });
    doubles.getAccessKey.mockResolvedValueOnce({ ...keyRecord, algorithm_version: "sha256-v0" });
    await expect(authController.previewWorkspaceKey(RAW_KEY)).resolves.toEqual({ valid: false });
    await expect(authController.previewWorkspaceKey("malformada")).resolves.toEqual({ valid: false });
  });

  it("multiform aceita identidade editada sem alterar a identidade emitida", async () => {
    doubles.getAccessKey.mockResolvedValueOnce(keyRecord);
    doubles.findUserByCanonicalEmail.mockResolvedValueOnce(null);
    doubles.usersFind.mockResolvedValueOnce({
      ...user,
      name: "Helder Editado",
      email: "novo@ifc.edu.br",
    });
    doubles.createWorkspaceWithKey.mockResolvedValueOnce(true);
    doubles.getForUser.mockResolvedValueOnce({ ...workspace, name: "Minha Equipe" });

    const result = await authController.registerWithWorkspace({
      key: RAW_KEY,
      name: "Helder Editado",
      email: "novo@ifc.edu.br",
      password: "segredo",
      workspaceName: "Minha Equipe",
    });

    expect(result.ok).toBe(true);
    expect(doubles.createWorkspaceWithKey).toHaveBeenCalledWith(expect.objectContaining({
      userName: "Helder Editado",
      userEmail: "novo@ifc.edu.br",
      workspaceName: "Minha Equipe",
      keyId: keyRecord.id,
      keyHash: keyRecord.key_hash,
    }));
    const provision = doubles.createWorkspaceWithKey.mock.calls[0]![0];
    expect(provision).not.toHaveProperty("issuedEmail");
    expect(provision).not.toHaveProperty("issuedName");
  });

  it("chave inválida não consulta se o e-mail já existe", async () => {
    doubles.getAccessKey.mockResolvedValueOnce(null);

    await expect(authController.registerWithWorkspace({
      key: RAW_KEY,
      name: "Helder",
      email: "alvo@example.com",
      password: "segredo",
      workspaceName: "Equipe",
    })).resolves.toEqual({ ok: false, reason: "invalid_key" });

    expect(doubles.findUserByCanonicalEmail).not.toHaveBeenCalled();
    expect(doubles.hash).not.toHaveBeenCalled();
    expect(doubles.createWorkspaceWithKey).not.toHaveBeenCalled();
  });

  it("rejeita cadastro sem nome e e-mail inválido antes de gravar", async () => {
    await expect(authController.register({
      name: " ",
      email: "invalido",
      password: "segredo",
    })).resolves.toEqual({ ok: false, reason: "validation" });

    expect(doubles.usersFind).not.toHaveBeenCalled();
    expect(doubles.createPrivateWorkspace).not.toHaveBeenCalled();
  });

  it("rejeita senha que excede os 72 bytes aceitos pelo bcrypt", async () => {
    await expect(authController.register({
      name: "Helder",
      email: "helder@ifc.edu.br",
      password: "á".repeat(37),
    })).resolves.toEqual({ ok: false, reason: "validation" });

    expect(doubles.usersFind).not.toHaveBeenCalled();
    expect(doubles.hash).not.toHaveBeenCalled();
  });

  it("normaliza o e-mail também na fronteira de login", async () => {
    doubles.findUserByCanonicalEmail.mockResolvedValueOnce(user);
    doubles.compare.mockResolvedValueOnce(true);

    await expect(authController.login({
      email: " HELDER@IFC.ESTUDANTES.EDU.BR ",
      password: "segredo",
    })).resolves.toMatchObject({ user: { id: user.id } });

    expect(doubles.findUserByCanonicalEmail).toHaveBeenCalledWith(
      "helder@ifc.estudantes.edu.br",
    );
  });
});
