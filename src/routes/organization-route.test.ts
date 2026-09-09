import { createServer, type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "01KXDN4AXN6QJBTZTCWP1JWVW4";
const WORKSPACE_ID = "01KXDN4B182DJGAKPX0940H54N";
const ORGANIZATION_ID = "01KXDN4B182DJGAKPX0940H55A";

const controller = vi.hoisted(() => ({
  listForUser: vi.fn(),
  create: vi.fn(),
  linkWorkspace: vi.fn(),
  searchWorkspaceUsers: vi.fn(),
  addWorkspaceUser: vi.fn(),
}));

vi.mock("@controllers/organizations-controller", () => ({ default: controller }));
vi.mock("@/core/auth/middleware", () => ({
  default: {
    handle: (request: unknown, _response: unknown, next: () => void) => {
      (request as { userId?: string }).userId = USER_ID;
      next();
    },
  },
}));

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const { default: organizationRouter } = await import("@routes/organization-route");
  const app = express();
  app.use(express.json());
  app.use("/organizations", organizationRouter);
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

describe("OrganizationRouter", () => {
  it("lista somente as organizações do usuário autenticado", async () => {
    controller.listForUser.mockResolvedValueOnce([{ id: ORGANIZATION_ID }]);
    const response = await request("/organizations");
    expect(response.status).toBe(200);
    expect(controller.listForUser).toHaveBeenCalledWith(USER_ID);
  });

  it("cria organização com a primeira workspace e vincula outras explicitamente", async () => {
    controller.create.mockResolvedValueOnce({ ok: true, data: { id: ORGANIZATION_ID } });
    const created = await request("/organizations", "POST", {
      name: "IFC",
      workspaceId: WORKSPACE_ID,
    });
    expect(created.status).toBe(201);
    expect(controller.create).toHaveBeenCalledWith(USER_ID, {
      name: "IFC",
      workspaceId: WORKSPACE_ID,
    });

    controller.linkWorkspace.mockResolvedValueOnce({ ok: true, data: { id: WORKSPACE_ID } });
    const linked = await request(
      `/organizations/${ORGANIZATION_ID}/workspaces/${WORKSPACE_ID}`,
      "PUT",
    );
    expect(linked.status).toBe(200);
    expect(controller.linkWorkspace).toHaveBeenCalledWith(
      ORGANIZATION_ID,
      WORKSPACE_ID,
      USER_ID,
    );
  });

  it("preserva 403 quando o usuário não administra os dois lados", async () => {
    controller.linkWorkspace.mockResolvedValueOnce({
      ok: false,
      reason: "forbidden",
      message: "Acesso não permitido",
    });
    const response = await request(
      `/organizations/${ORGANIZATION_ID}/workspaces/${WORKSPACE_ID}`,
      "PUT",
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ message: "Acesso não permitido" });
  });

  it("busca e adiciona usuários no escopo organização + workspace", async () => {
    controller.searchWorkspaceUsers.mockResolvedValueOnce({ ok: true, data: [] });
    const searched = await request(
      `/organizations/${ORGANIZATION_ID}/workspaces/${WORKSPACE_ID}/users?q=ana`,
    );
    expect(searched.status).toBe(200);
    expect(controller.searchWorkspaceUsers).toHaveBeenCalledWith(
      ORGANIZATION_ID,
      WORKSPACE_ID,
      USER_ID,
      "ana",
    );

    const targetId = "01KXDN4B182DJGAKPX0940H54P";
    controller.addWorkspaceUser.mockResolvedValueOnce({ ok: true, data: { id: targetId } });
    const added = await request(
      `/organizations/${ORGANIZATION_ID}/workspaces/${WORKSPACE_ID}/users/${targetId}`,
      "POST",
    );
    expect(added.status).toBe(201);
    expect(controller.addWorkspaceUser).toHaveBeenCalledWith(
      ORGANIZATION_ID,
      WORKSPACE_ID,
      USER_ID,
      targetId,
    );
  });
});
