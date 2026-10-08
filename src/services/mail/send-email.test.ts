import { describe, expect, it, vi } from "vitest";
import { accountVerificationEmail } from "./account-verification-email.js";
import { SendEmail } from "./send-email.js";
import { Smtp, type SmtpConfiguration } from "./smtp.js";

const env = { SMTP_HOST: "smtp.example.com", SMTP_FROM_EMAIL: "cubs@example.com" };
const smtpConfiguration: SmtpConfiguration = {
  host: env.SMTP_HOST,
  port: 587,
  secure: false,
  requireTLS: true,
};
const from = { name: "Cub's", email: env.SMTP_FROM_EMAIL };
const invitation = () => accountVerificationEmail.create({
  name: "Ana <Admin>", email: "ana@example.com",
  verificationUrl: "https://cubs.example.com/pt-br/verify-email/cubs_verify_v1_test",
});

function transport() {
  return {
    sendMail: vi.fn().mockResolvedValue({
      accepted: ["ana@example.com"], rejected: [], messageId: "mail-1",
    }),
    verify: vi.fn().mockResolvedValue(true),
    close: vi.fn(),
  };
}

describe("Smtp", () => {
  it("exige configuração completa e protege TLS em produção", () => {
    expect(() => Smtp.configurationFromEnvironment({})).toThrow("SMTP_HOST");
    expect(() => Smtp.configurationFromEnvironment({ ...env, SMTP_USER: "user" })).toThrow("juntos");
    expect(() => Smtp.configurationFromEnvironment({ ...env, SMTP_PORT: "NaN" })).toThrow("SMTP_PORT");
    expect(() => Smtp.configurationFromEnvironment({ ...env, SMTP_SECURE: "typo" })).toThrow("SMTP_SECURE");
    expect(() => Smtp.configurationFromEnvironment({ ...env, SMTP_REQUIRE_TLS: "false" })).toThrow("TLS");
    expect(Smtp.configurationFromEnvironment(env)).toMatchObject({
      smtp: { host: env.SMTP_HOST, port: 587, secure: false, requireTLS: true },
      from,
    });
    expect(() => Smtp.configurationFromEnvironment({ ...env, SMTP_PORT: "465" })).not.toThrow();
  });

  it("distingue credenciais recusadas de falha de conexão sem vazar o provedor", async () => {
    const adapter = transport();
    const smtp = new Smtp(smtpConfiguration, adapter);

    adapter.sendMail.mockRejectedValueOnce(Object.assign(new Error("SECRET_PROVIDER_PASSWORD"), { code: "EAUTH" }));
    await expect(smtp.deliver({
      from,
      to: { name: "Ana", email: "ana@example.com" },
      subject: "Teste",
      content: { html: "<p>Teste</p>" },
    })).rejects.toMatchObject({
      code: "authentication",
      message: "O SMTP recusou as credenciais. Confira SMTP_USER e SMTP_PASSWORD.",
      retryable: false,
    });

    adapter.verify.mockRejectedValueOnce(Object.assign(new Error("secret endpoint"), { code: "ECONNECTION" }));
    await expect(smtp.verify()).rejects.toMatchObject({
      code: "connection",
      message: "Não foi possível conectar ao SMTP. Confira host, porta e TLS.",
      retryable: true,
    });
  });
});

describe("SendEmail", () => {
  it("entrega o conteúdo recebido sem transformá-lo e confirma a aceitação SMTP", async () => {
    const adapter = transport();
    const smtp = new Smtp(smtpConfiguration, adapter);
    const failures = vi.fn();
    const sender = new SendEmail(smtp, from, failures);
    const email = invitation();

    await expect(sender.send({
      to: { name: "Ana <Admin>", email: "ana@example.com" },
      ...email,
    })).resolves.toEqual({ messageId: "mail-1" });
    expect(adapter.sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: { name: "Cub's", address: "cubs@example.com" },
      to: { name: "Ana <Admin>", address: "ana@example.com" },
      text: expect.stringContaining("cubs_verify_v1_test"),
      html: expect.stringContaining("cubs_verify_v1_test"),
      disableFileAccess: true,
      disableUrlAccess: true,
    }));
    expect(failures).not.toHaveBeenCalled();
    sender.close();
    expect(adapter.close).toHaveBeenCalledOnce();
  });

  it("valida o envelope antes da entrega e expõe feedback seguro e tipado", async () => {
    const adapter = transport();
    const failures = vi.fn();
    const sender = new SendEmail(new Smtp(smtpConfiguration, adapter), from, failures);

    await expect(sender.send({
      to: { name: "Ana", email: "a@example.com,b@example.com" },
      ...invitation(),
    })).rejects.toMatchObject({ code: "invalid_message", retryable: false });
    expect(adapter.sendMail).not.toHaveBeenCalled();
    expect(failures).toHaveBeenCalledWith(expect.objectContaining({
      code: "invalid_message",
      message: expect.not.stringContaining("SECRET"),
    }));

    adapter.sendMail.mockResolvedValueOnce({
      accepted: [], rejected: ["ana@example.com"], messageId: "mail-2",
    });
    await expect(sender.send({
      to: { name: "Ana", email: "ana@example.com" },
      ...invitation(),
    })).rejects.toMatchObject({ code: "recipient_rejected", retryable: false });
  });
});

describe("accountVerificationEmail", () => {
  it("produz apenas conteúdo, escapa a identidade e mantém somente o link validado", () => {
    const email = invitation();
    expect(email.content.html).toContain("Ana &lt;Admin&gt;");
    expect(email.content.html).not.toContain("<Admin>");
    expect(email.content.html).not.toMatch(/<script|onclick|javascript:/i);
    expect([...email.content.html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]))
      .toEqual(["https://cubs.example.com/pt-br/verify-email/cubs_verify_v1_test"]);
    expect(email.content.text).toContain("ana@example.com");
    expect(email).not.toHaveProperty("to");
  });

  it("recusa links inseguros", () => {
    const input = { name: "Ana", email: "ana@example.com", verificationUrl: "javascript:alert(1)" };
    expect(() => accountVerificationEmail.create(input)).toThrow("URL");
    expect(() => accountVerificationEmail.create({ ...input, verificationUrl: "http://example.com" })).toThrow("HTTPS");
    expect(() => accountVerificationEmail.create({
      ...input,
      verificationUrl: "https://cubs.example.com/pt-br/verify-email/token?redirect=https%3A%2F%2Fevil.example",
    })).toThrow("URL");
  });

  it("aceita somente o retorno conhecido para criar organização", () => {
    const email = accountVerificationEmail.create({
      name: "Ana",
      email: "ana@example.com",
      verificationUrl: "http://localhost:5173/pt-br/verify-email/token?returnTo=%2Fpt-br%2Forganizations%2Fnew",
    });
    expect(email.content.text).toContain("returnTo=%2Fpt-br%2Forganizations%2Fnew");
  });
});
