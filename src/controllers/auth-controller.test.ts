import { beforeEach, describe, expect, it, vi } from "vitest";

const doubles = vi.hoisted(() => ({
  usersFind: vi.fn(),
  usersUpdate: vi.fn(),
  compare: vi.fn(),
  issueTokenPair: vi.fn(),
  findUserByCanonicalEmail: vi.fn(),
  getInviteByTokenHash: vi.fn(),
  beginVerification: vi.fn(),
  previewVerification: vi.fn(),
  resendVerification: vi.fn(),
  completeVerification: vi.fn(),
}));

vi.mock("@/core/db/model", () => ({
  Model: class {
    find = doubles.usersFind;
    update = doubles.usersUpdate;
  },
}));
vi.mock("bcryptjs", () => ({ default: { compare: doubles.compare } }));
vi.mock("@core/auth/jwt-service", () => ({ default: { issueTokenPair: doubles.issueTokenPair } }));
vi.mock("@db/auth-onboarding-store", () => ({
  default: { findUserByCanonicalEmail: doubles.findUserByCanonicalEmail },
}));
vi.mock("@db/access-invite-store", () => ({
  default: { getByTokenHash: doubles.getInviteByTokenHash },
}));
vi.mock("@/services/account-verification", () => ({
  default: {
    begin: doubles.beginVerification,
    preview: doubles.previewVerification,
    resend: doubles.resendVerification,
    complete: doubles.completeVerification,
  },
}));

import authController from "./auth-controller.js";

const user = {
  id: "01KXDN4AXN6QJBTZTCWP1JWVW4",
  name: "Helder da Silva",
  email: "helder@ifc.estudantes.edu.br",
  password_hash: "bcrypt-hash",
  email_verified_at: "2026-09-12T12:00:00.000Z",
  token_version: 0,
  created_at: new Date(),
  updated_at: new Date(),
};
const verificationStarted = {
  ok: true as const,
  email: "helder@ifc.estudantes.edu.br",
  notificationPending: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  doubles.issueTokenPair.mockReturnValue({ accessToken: "access-token", refreshToken: "refresh-token" });
});

describe("AuthController onboarding", () => {
  it("cadastro comum normaliza a identidade e inicia a validação do e-mail", async () => {
    doubles.findUserByCanonicalEmail.mockResolvedValueOnce(null);
    doubles.beginVerification.mockResolvedValueOnce(verificationStarted);

    await expect(authController.register({
      name: "  Helder   da Silva ",
      email: " HELDER@IFC.ESTUDANTES.EDU.BR ",
      returnTo: "/pt-br/organizations/new",
    })).resolves.toEqual({
      ok: true,
      verificationRequired: true,
      email: verificationStarted.email,
      notificationPending: false,
    });

    expect(doubles.beginVerification).toHaveBeenCalledWith({
      name: "Helder da Silva",
      email: "helder@ifc.estudantes.edu.br",
      inviteId: null,
      context: { kind: "native", returnTo: "/pt-br/organizations/new" },
    });
    expect(doubles.issueTokenPair).not.toHaveBeenCalled();
  });

  it("rejeita cadastro sem nome e e-mail válido antes de gravar", async () => {
    await expect(authController.register({ name: " ", email: "invalido" }))
      .resolves.toEqual({ ok: false, reason: "validation" });

    expect(doubles.findUserByCanonicalEmail).not.toHaveBeenCalled();
    expect(doubles.beginVerification).not.toHaveBeenCalled();
  });

  it("normaliza o e-mail e exige conta validada no login", async () => {
    doubles.findUserByCanonicalEmail.mockResolvedValueOnce(user);
    doubles.compare.mockResolvedValueOnce(true);

    await expect(authController.login({
      email: " HELDER@IFC.ESTUDANTES.EDU.BR ",
      password: "segredo",
    })).resolves.toMatchObject({ user: { id: user.id } });

    expect(doubles.findUserByCanonicalEmail).toHaveBeenCalledWith("helder@ifc.estudantes.edu.br");
  });
});
