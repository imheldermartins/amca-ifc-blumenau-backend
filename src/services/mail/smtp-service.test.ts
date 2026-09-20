import { describe, expect, it, vi } from "vitest";
import { readSmtpConfiguration, SmtpService } from "./smtp-service.js";
import { accountVerificationEmail } from "./account-verification-email.js";

const env = { SMTP_HOST: "smtp.example.com", SMTP_FROM_EMAIL: "cubs@example.com" };
const invitation = () => accountVerificationEmail({
  name: "Ana <Admin>", email: "ana@example.com",
  verificationUrl: "https://cubs.example.com/pt-br/verify-email/cubs_verify_v1_test",
});

describe("SmtpService", () => {
  it("exige configuração completa e protege TLS em produção", () => {
    expect(() => readSmtpConfiguration({})).toThrow("SMTP_HOST");
    expect(() => readSmtpConfiguration({ ...env, SMTP_USER: "user" })).toThrow("juntos");
    expect(() => readSmtpConfiguration({ ...env, SMTP_PORT: "NaN" })).toThrow("SMTP_PORT");
    expect(() => readSmtpConfiguration({ ...env, SMTP_SECURE: "typo" })).toThrow("SMTP_SECURE");
    expect(() => readSmtpConfiguration({ ...env, SMTP_REQUIRE_TLS: "false" })).toThrow("TLS");
    expect(readSmtpConfiguration(env)).toMatchObject({ port: 587, secure: false, requireTLS: true });
    expect(readSmtpConfiguration({ ...env, SMTP_PORT: "465" })).toMatchObject({ port: 465, secure: true });
  });

  it("envia HTML e texto ao destinatário e só confirma aceitação pelo SMTP", async () => {
    const transport = {
      sendMail: vi.fn().mockResolvedValue({ accepted: ["ana@example.com"], rejected: [], messageId: "mail-1" }),
      verify: vi.fn().mockResolvedValue(true), close: vi.fn(),
    };
    const smtp = new SmtpService(readSmtpConfiguration(env), transport);
    await expect(smtp.send(invitation())).resolves.toEqual({ messageId: "mail-1" });
    expect(transport.sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: { name: "Cub's", address: "cubs@example.com" },
      to: { name: "Ana <Admin>", address: "ana@example.com" },
      text: expect.stringContaining("cubs_verify_v1_test"),
      html: expect.stringContaining("cubs_verify_v1_test"),
      disableFileAccess: true, disableUrlAccess: true,
    }));
    transport.sendMail.mockResolvedValueOnce({ accepted: [], rejected: ["ana@example.com"], messageId: "mail-2" });
    await expect(smtp.send(invitation())).rejects.toThrow("não confirmou");
    transport.sendMail.mockRejectedValueOnce(new Error("SECRET_PROVIDER_PASSWORD"));
    await expect(smtp.send(invitation())).rejects.toThrow("O servidor SMTP não confirmou o envio do e-mail.");
    smtp.close();
    expect(transport.close).toHaveBeenCalledOnce();
  });

  it("recusa destinatário inválido antes de chamar o transporte e não expõe falhas de conexão", async () => {
    const transport = { sendMail: vi.fn(), verify: vi.fn().mockRejectedValue(new Error("secret")), close: vi.fn() };
    const smtp = new SmtpService(readSmtpConfiguration(env), transport);
    await expect(smtp.send({ ...invitation(), to: { name: "Ana", email: "a@example.com,b@example.com" } })).rejects.toThrow("inválido");
    expect(transport.sendMail).not.toHaveBeenCalled();
    await expect(smtp.verify()).rejects.toThrow("Não foi possível conectar ao SMTP");
  });
});

describe("accountVerificationEmail", () => {
  it("escapa a identidade e mantém somente o link validado", () => {
    const message = invitation();
    expect(message.html).toContain("Ana &lt;Admin&gt;");
    expect(message.html).not.toContain("<Admin>");
    expect(message.html).not.toMatch(/<script|onclick|javascript:/i);
    expect([...message.html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]))
      .toEqual(["https://cubs.example.com/pt-br/verify-email/cubs_verify_v1_test"]);
    expect(message.text).toContain("ana@example.com");
  });

  it("recusa links inseguros", () => {
    const input = { name: "Ana", email: "ana@example.com", verificationUrl: "javascript:alert(1)" };
    expect(() => accountVerificationEmail(input)).toThrow("URL");
    expect(() => accountVerificationEmail({ ...input, verificationUrl: "http://example.com" })).toThrow("HTTPS");
    expect(() => accountVerificationEmail({
      ...input,
      verificationUrl: "https://cubs.example.com/pt-br/verify-email/token?redirect=https%3A%2F%2Fevil.example",
    })).toThrow("URL");
  });

  it("aceita somente o retorno conhecido para criar organização", () => {
    const message = accountVerificationEmail({
      name: "Ana",
      email: "ana@example.com",
      verificationUrl: "http://localhost:5173/pt-br/verify-email/token?returnTo=%2Fpt-br%2Forganizations%2Fnew",
    });
    expect(message.text).toContain("returnTo=%2Fpt-br%2Forganizations%2Fnew");
  });
});
