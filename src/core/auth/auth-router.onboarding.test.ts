import { createServer, type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const controller = vi.hoisted(() => ({
  previewWorkspaceKey: vi.fn(),
  registerWithWorkspace: vi.fn(),
  register: vi.fn(),
  login: vi.fn(),
  refresh: vi.fn(),
  revoke: vi.fn(),
  me: vi.fn(),
}));

vi.mock("@/controllers/auth-controller", () => ({ default: controller }));
vi.mock("@core/http/rate-limit.config", () => ({
  authRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
  workspaceKeyPreviewRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("@core/auth/middleware", () => ({
  default: { handle: (_req: unknown, _res: unknown, next: () => void) => next() },
}));
vi.mock("@core/http/csrf-guard", () => ({
  requireClientHeader: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const user = { id: "user", name: "Helder", email: "helder@ifc.edu.br" };
const workspace = {
  id: "workspace",
  name: "Area de Trabalho do Helder",
  icon: "lucide:boxes",
  role: "superadmin",
  pageRootId: "workspace",
};
const success = {
  ok: true as const,
  user,
  workspace,
  tokens: { accessToken: "access-token", refreshToken: "refresh-token" },
};

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const { default: authRouter } = await import("./auth-router.js");
  const app = express();
  app.use(express.json());
  app.use("/auth", authRouter);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Porta efêmera indisponível");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

beforeEach(() => vi.clearAllMocks());

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("AuthRouter onboarding", () => {
  it("preview conserva uma resposta 200 genérica", async () => {
    controller.previewWorkspaceKey
      .mockResolvedValueOnce({ valid: true, name: "Helder", email: "helder@ifc.edu.br" })
      .mockResolvedValueOnce({ valid: false });

    const valid = await post("/auth/workspace-key/preview", { key: "segredo" });
    expect(valid.status).toBe(200);
    expect(valid.headers.get("cache-control")).toBe("no-store");
    expect(await valid.json()).toEqual({
      valid: true,
      name: "Helder",
      email: "helder@ifc.edu.br",
    });

    const invalid = await post("/auth/workspace-key/preview", { key: "outra" });
    expect(invalid.status).toBe(200);
    expect(await invalid.json()).toEqual({ valid: false });
  });

  it("cadastro comum devolve sessão e workspace privada", async () => {
    controller.register.mockResolvedValueOnce(success);

    const response = await post("/auth/register", {
      name: "Helder",
      email: "helder@ifc.edu.br",
      password: "segredo",
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ user, accessToken: "access-token", workspace });
    expect(response.headers.get("set-cookie")).toContain("cubs_rt=refresh-token");
  });

  it("cadastro por chave repassa todos os campos editáveis", async () => {
    controller.registerWithWorkspace.mockResolvedValueOnce({
      ...success,
      workspace: { ...workspace, name: "Minha Workspace" },
    });
    const payload = {
      key: "chave",
      name: "Helder Editado",
      email: "novo@ifc.edu.br",
      password: "segredo",
      workspaceName: "Minha Workspace",
    };

    const response = await post("/auth/register/workspace", payload);

    expect(response.status).toBe(201);
    expect(controller.registerWithWorkspace).toHaveBeenCalledWith(payload);
    expect(await response.json()).toMatchObject({
      user,
      accessToken: "access-token",
      workspace: { name: "Minha Workspace" },
    });
  });

  it("mapeia chave inválida sem revelar o estado da credencial", async () => {
    controller.registerWithWorkspace.mockResolvedValueOnce({
      ok: false,
      reason: "invalid_key",
    });

    const response = await post("/auth/register/workspace", {
      key: "chave",
      name: "Helder",
      email: "helder@ifc.edu.br",
      password: "segredo",
      workspaceName: "Minha Workspace",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ message: "Chave de workspace inválida" });
  });
});
