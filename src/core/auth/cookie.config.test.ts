import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A política do cookie de sessão por ambiente. É o contrato com o navegador, e
 * um atributo errado tem modo de falha SILENCIOSO — o cookie é descartado sem
 * erro, e a sessão "some". Por isso é testado, e por isso o teste é explícito
 * sobre cada atributo.
 *
 * `core/env.ts` lê `NODE_ENV` no momento do import, então cada cenário reseta
 * os módulos e reimporta com o ambiente já montado — é a única forma de
 * exercitar dev e prod no mesmo arquivo.
 */
const ORIGINAL_ENV = { ...process.env };

async function loadCookieConfig(env: Record<string, string | undefined>) {
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV, ...env };
  return import("@core/auth/cookie.config");
}

beforeEach(() => vi.resetModules());
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("cookie.config — produção", () => {
  it("usa o prefixo __Host- e Secure", async () => {
    const { REFRESH_COOKIE_NAME, refreshCookieOptions } = await loadCookieConfig({
      NODE_ENV: "production",
    });

    expect(REFRESH_COOKIE_NAME).toBe("__Host-cubs_rt");
    expect(refreshCookieOptions().secure).toBe(true);
  });

  it("é HttpOnly, SameSite=Lax, Path=/ e SEM Domain", async () => {
    const { refreshCookieOptions } = await loadCookieConfig({ NODE_ENV: "production" });
    const options = refreshCookieOptions();

    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("lax");
    expect(options.path).toBe("/");
    // O prefixo __Host- PROÍBE Domain — declará-lo invalidaria o cookie.
    expect(options.domain).toBeUndefined();
  });

  it("o cookie de remoção casa os atributos (senão o navegador não apaga)", async () => {
    const { clearRefreshCookieOptions } = await loadCookieConfig({ NODE_ENV: "production" });
    const options = clearRefreshCookieOptions();

    expect(options.httpOnly).toBe(true);
    expect(options.secure).toBe(true);
    expect(options.sameSite).toBe("lax");
    expect(options.path).toBe("/");
  });
});

describe("cookie.config — desenvolvimento", () => {
  it("SEM prefixo e SEM Secure (http)", async () => {
    const { REFRESH_COOKIE_NAME, refreshCookieOptions } = await loadCookieConfig({
      NODE_ENV: "development",
    });

    expect(REFRESH_COOKIE_NAME).toBe("cubs_rt");
    expect(refreshCookieOptions().secure).toBe(false);
  });

  it("mantém HttpOnly e SameSite=Lax mesmo sem Secure", async () => {
    const { refreshCookieOptions } = await loadCookieConfig({ NODE_ENV: "development" });
    const options = refreshCookieOptions();

    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("lax");
  });

  it("COOKIE_SECURE=1 liga o Secure e o prefixo (túnel https em dev)", async () => {
    const { REFRESH_COOKIE_NAME, refreshCookieOptions } = await loadCookieConfig({
      NODE_ENV: "development",
      COOKIE_SECURE: "1",
    });

    // Nome e Secure não podem divergir — o prefixo __Host- EXIGE Secure.
    expect(REFRESH_COOKIE_NAME).toBe("__Host-cubs_rt");
    expect(refreshCookieOptions().secure).toBe(true);
  });
});
