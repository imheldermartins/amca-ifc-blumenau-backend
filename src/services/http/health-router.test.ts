import { describe, expect, it, vi } from "vitest";
import { isDatabaseReady } from "./health-router.js";

describe("isDatabaseReady", () => {
  it("aceita o readyz do rqlite", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("[+]node ok\n[+]leader ok\n[+]store ok", { status: 200 }),
    );

    await expect(isDatabaseReady("http://rqlite:4001", fetchImplementation)).resolves.toBe(true);
    expect(fetchImplementation).toHaveBeenCalledWith(
      "http://rqlite:4001/readyz",
      expect.objectContaining({ method: "GET", signal: expect.any(AbortSignal) }),
    );
  });

  it("rejeita banco não pronto", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("[+]node ok\n[+]leader not found", { status: 503 }),
    );

    await expect(isDatabaseReady("http://rqlite:4001", fetchImplementation)).resolves.toBe(false);
  });

  it("rejeita falha de conexão sem vazar a exceção", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockRejectedValue(new Error("connect ECONNREFUSED"));

    await expect(isDatabaseReady("http://rqlite:4001", fetchImplementation)).resolves.toBe(false);
  });
});
