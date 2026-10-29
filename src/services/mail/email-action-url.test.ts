import { afterEach, describe, expect, it, vi } from "vitest";
import { validateEmailActionUrl } from "./email-action-url.js";

afterEach(() => vi.unstubAllEnvs());

describe("validateEmailActionUrl", () => {
  it.each(["http://localhost:5173", "https://localhost", "http://127.0.0.1:5173", "https://127.0.0.2", "http://[::1]:5173", "https://app.localhost"])(
    "recusa endereço local em produção: %s", (origin) => {
      vi.stubEnv("NODE_ENV", "production");
      expect(() => validateEmailActionUrl(`${origin}/pt-br/invite/token`)).toThrow("localhost em produção");
    },
  );

  it("preserva o token e o retorno de ativação no domínio público", () => {
    vi.stubEnv("NODE_ENV", "production");
    const url = "https://cubsonline.com.br/pt-br/verify-email/token?returnTo=%2Fpt-br%2Forganizations%2Fnew";
    expect(validateEmailActionUrl(url)).toBe(url);
  });

  it("permite testar links locais em desenvolvimento", () => {
    vi.stubEnv("NODE_ENV", "development");
    const url = "http://localhost:5173/pt-br/invite/token";
    expect(validateEmailActionUrl(url)).toBe(url);
  });
});
