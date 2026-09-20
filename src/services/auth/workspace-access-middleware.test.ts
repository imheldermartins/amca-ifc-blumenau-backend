import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ can: vi.fn() }));
vi.mock("@db/scoped-access-store", () => ({ default: store }));

import { requireWorkspaceAbility } from "./workspace-access-middleware.js";

const WORKSPACE_ID = "01KXDN4B182DJGAKPX0940H54N";
const USER_ID = "01KXDN4AXN6QJBTZTCWP1JWVW4";

function response() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  return { value: { status, locals: {} }, status, json };
}

beforeEach(() => vi.clearAllMocks());

describe("requireWorkspaceAbility", () => {
  it("permite quem possui update no painel", async () => {
    store.can.mockResolvedValue(true);
    const res = response();
    const next = vi.fn();

    await requireWorkspaceAbility("manage", "WorkspaceSettings")(
      { userId: USER_ID, params: { id: WORKSPACE_ID } } as never,
      res.value as never,
      next,
    );

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("nega promoção sem promote_members", async () => {
    store.can.mockResolvedValue(false);
    const res = response();
    const next = vi.fn();

    await requireWorkspaceAbility("manage", "WorkspaceMembers")(
      { userId: USER_ID, params: { id: WORKSPACE_ID } } as never,
      res.value as never,
      next,
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: "Acesso não permitido" });
    expect(next).not.toHaveBeenCalled();
  });

  it("nega workspace sem permissão de leitura", async () => {
    store.can.mockResolvedValue(false);
    const res = response();

    await requireWorkspaceAbility("read", "Workspace")(
      { userId: USER_ID, params: { id: WORKSPACE_ID } } as never,
      res.value as never,
      vi.fn(),
    );

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("mantém o envelope de erro da API se a consulta de acesso falhar", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    store.can.mockRejectedValue(new Error("offline", { cause: "SQLERROR" }));
    const res = response();
    const next = vi.fn();

    await requireWorkspaceAbility("read", "Workspace")(
      { userId: USER_ID, params: { id: WORKSPACE_ID } } as never,
      res.value as never,
      next,
    );

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ message: "Erro no servidor" });
    expect(next).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
