import { createServer, type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "01KXDN4AXN6QJBTZTCWP1JWVW4";
const WORKSPACE_ID = "01KXDN4B182DJGAKPX0940H54N";

const controller = vi.hoisted(() => ({
  listForUser: vi.fn(),
  validateAccessKey: vi.fn(),
  joinWithKey: vi.fn(),
  createWithKey: vi.fn(),
  getPageRoot: vi.fn(),
  listMembers: vi.fn(),
  updateMemberRole: vi.fn(),
  getForUser: vi.fn(),
  updateSettings: vi.fn(),
}));

vi.mock("@/controllers/workspaces-controller", () => ({ default: controller }));
vi.mock("@/core/auth/middleware", () => ({
  default: {
    handle: (request: unknown, _response: unknown, next: () => void) => {
      (request as { userId?: string }).userId = USER_ID;
      next();
    },
  },
}));
vi.mock("@/core/auth/workspace-access-middleware", () => ({
  requireWorkspaceAbility: () => (
    _request: unknown,
    _response: unknown,
    next: () => void,
  ) => next(),
}));

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const { default: workspaceRouter } = await import("@routes/workspace-route");
  const app = express();
  app.use(express.json());
  app.use("/workspaces", workspaceRouter);
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

async function request(path: string, method = "GET", body?: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    ...(body !== undefined && {
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  });
}

describe("WorkspaceRouter", () => {
  it("lista apenas pelo usuário autenticado", async () => {
    controller.listForUser.mockResolvedValueOnce([{ id: WORKSPACE_ID }]);

    const response = await request("/workspaces");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ id: WORKSPACE_ID }]);
    expect(controller.listForUser).toHaveBeenCalledWith(USER_ID);
  });

  it("cria e entra somente pelos comandos explícitos com chave", async () => {
    controller.createWithKey.mockResolvedValueOnce({
      ok: true,
      data: { id: WORKSPACE_ID, role: "superadmin" },
    });
    const created = await request("/workspaces", "POST", { name: "IFC", key: "secret" });
    expect(created.status).toBe(201);
    expect(controller.createWithKey).toHaveBeenCalledWith(USER_ID, {
      name: "IFC",
      key: "secret",
      organizationId: undefined,
    });

    controller.joinWithKey.mockResolvedValueOnce({
      ok: true,
      data: { id: WORKSPACE_ID, role: "member" },
    });
    const joined = await request("/workspaces/join", "POST", { key: "join-secret" });
    expect(joined.status).toBe(201);
    expect(controller.joinWithKey).toHaveBeenCalledWith(USER_ID, "join-secret");
  });

  it("mantém o envelope { message } e status de domínio", async () => {
    controller.updateMemberRole.mockResolvedValueOnce({
      ok: false,
      reason: "conflict",
      message: "A workspace precisa manter ao menos um superadmin",
    });

    const response = await request(
      `/workspaces/${WORKSPACE_ID}/members/${USER_ID}/role`,
      "PUT",
      { role: "member" },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      message: "A workspace precisa manter ao menos um superadmin",
    });
  });

  it("valida a finalidade antes de consultar a chave", async () => {
    const response = await request("/workspaces/access-keys/validate", "POST", {
      key: "secret",
      purpose: "admin",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ message: "Finalidade inválida" });
    expect(controller.validateAccessKey).not.toHaveBeenCalled();
  });
});
