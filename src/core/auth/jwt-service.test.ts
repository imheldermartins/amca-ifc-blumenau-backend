import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O fail-fast dos segredos — o achado mais grave que abriu a leva. Com a env
 * ausente, o jwt-service antigo assinava com um fallback literal versionado no
 * repositório: qualquer pessoa forjaria um token para qualquer `sub`. A regra
 * agora é RECUSAR o boot em produção, e é isso que estes testes travam.
 *
 * O segredo é resolvido no construtor da classe, que roda no import
 * (`export default new JwtService()`). Então "instanciar" = importar, e o
 * throw acontece no import — daí o `vi.resetModules()` + import dinâmico.
 */
const ORIGINAL_ENV = { ...process.env };
const SEGREDO_VALIDO = "a".repeat(64); // 64 chars, acima do mínimo de 32

async function loadJwtService(env: Record<string, string | undefined>) {
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV, ...env };
  // Silencia o warnOnce de dev — o teste não precisa do ruído no output.
  vi.spyOn(console, "warn").mockImplementation(() => {});
  return import("@core/auth/jwt-service");
}

beforeEach(() => vi.resetModules());
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("jwt-service — fail-fast em produção", () => {
  it("LANÇA quando o segredo está ausente", async () => {
    await expect(
      loadJwtService({
        NODE_ENV: "production",
        JWT_ACCESS_SECRET: undefined,
        JWT_REFRESH_SECRET: SEGREDO_VALIDO,
        CORS_ORIGINS: "https://x.com",
      }),
    ).rejects.toThrow(/JWT_ACCESS_SECRET/);
  });

  it("LANÇA quando o segredo é curto demais (< 32)", async () => {
    await expect(
      loadJwtService({
        NODE_ENV: "production",
        JWT_ACCESS_SECRET: "curto",
        JWT_REFRESH_SECRET: SEGREDO_VALIDO,
        CORS_ORIGINS: "https://x.com",
      }),
    ).rejects.toThrow(/menos de 32/);
  });

  it("SOBE quando os dois segredos são válidos", async () => {
    const mod = await loadJwtService({
      NODE_ENV: "production",
      JWT_ACCESS_SECRET: SEGREDO_VALIDO,
      JWT_REFRESH_SECRET: `${SEGREDO_VALIDO}b`,
      CORS_ORIGINS: "https://x.com",
    });

    expect(mod.default).toBeDefined();
  });
});

describe("jwt-service — dev tolera fallback", () => {
  it("NÃO lança sem segredo (usa o fallback de desenvolvimento)", async () => {
    const mod = await loadJwtService({
      NODE_ENV: "development",
      JWT_ACCESS_SECRET: undefined,
      JWT_REFRESH_SECRET: undefined,
    });

    expect(mod.default).toBeDefined();
  });
});

describe("jwt-service — o refresh carrega o token_version", () => {
  it("emite o par com `tv` no refresh e valida de volta", async () => {
    const { default: jwtService } = await loadJwtService({
      NODE_ENV: "development",
    });

    const pair = jwtService.issueTokenPair({ sub: "user-1" }, 7);
    const refresh = jwtService.verifyRefreshToken(pair.refreshToken);

    expect(refresh.sub).toBe("user-1");
    expect(refresh.tv).toBe(7);
  });
});
