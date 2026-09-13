import { createServer, type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const controller = vi.hoisted(() => ({
  register: vi.fn(),
  login: vi.fn(),
  refresh: vi.fn(),
  revoke: vi.fn(),
  me: vi.fn(),
}));

vi.mock("@/controllers/auth-controller", () => ({ default: controller }));
vi.mock("@core/http/rate-limit.config", () => ({
  authRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("@core/auth/middleware", () => ({
  default: { handle: (_req: unknown, _res: unknown, next: () => void) => next() },
}));
vi.mock("@core/http/csrf-guard", () => ({
  requireClientHeader: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const success = {
  ok: true as const,
  verificationRequired: true as const,
  email: "helder@ifc.edu.br",
  notificationPending: false,
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
  it("cadastro comum solicita validação sem criar sessão", async () => {
    controller.register.mockResolvedValueOnce(success);

    const response = await post("/auth/register", {
      name: "Helder",
      email: "helder@ifc.edu.br",
      returnTo: "/pt-br/organizations/new",
    });

    expect(response.status).toBe(202);
    expect(controller.register).toHaveBeenCalledWith({
      name: "Helder",
      email: "helder@ifc.edu.br",
      inviteToken: undefined,
      returnTo: "/pt-br/organizations/new",
    });
    expect(await response.json()).toEqual(success);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

});
