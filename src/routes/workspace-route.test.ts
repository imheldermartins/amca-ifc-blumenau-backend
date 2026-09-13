import { createServer, type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "01KXDN4AXN6QJBTZTCWP1JWVW4";
const WORKSPACE_ID = "01KXDN4B182DJGAKPX0940H54N";
const ORGANIZATION_ID = "01KXDN4B182DJGAKPX0940H55A";

const controller = vi.hoisted(() => ({
  listForUser: vi.fn(),
  createInOrganization: vi.fn(),
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

  it("cria dentro de uma organização", async () => {
    controller.createInOrganization.mockResolvedValueOnce({
      ok: true,
      data: { id: WORKSPACE_ID, role: "superadmin" },
    });
    const created = await request("/workspaces", "POST", {
      name: "IFC",
      organizationId: ORGANIZATION_ID,
    });
    expect(created.status).toBe(201);
    expect(controller.createInOrganization).toHaveBeenCalledWith(USER_ID, {
      name: "IFC",
      organizationId: ORGANIZATION_ID,
    });

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

});
