import nodemailer from "nodemailer";
import type { MailMessage, MailTransport, SmtpConfiguration } from "@/services/mail/types/mail.types";
export type { MailMessage, MailTransport, SmtpConfiguration } from "@/services/mail/types/mail.types";

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/** Uma fronteira SMTP reutilizável; o transporte injetável permite testes sem envio externo. */
export class SmtpService {
  private readonly transport: MailTransport;

  constructor(private readonly configuration: SmtpConfiguration, transport?: MailTransport) {
    this.transport = transport ?? nodemailer.createTransport({
      host: configuration.host,
      port: configuration.port,
      secure: configuration.secure,
      requireTLS: configuration.requireTLS,
      ...(configuration.auth ? { auth: configuration.auth } : {}),
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
      disableFileAccess: true,
      disableUrlAccess: true,
      logger: false,
      debug: false,
    });
  }

  static fromEnvironment(env: NodeJS.ProcessEnv = process.env): SmtpService {
    return new SmtpService(this.readConfiguration(env));
  }

  async verify(): Promise<void> {
    try {
      await this.transport.verify();
    } catch {
      throw new Error("Não foi possível conectar ao SMTP. Confira a configuração do servidor.");
    }
  }

  async send(message: MailMessage): Promise<{ messageId: string }> {
    if (!message.to.name.trim() || !EMAIL.test(message.to.email) || /[\r\n]/.test(message.subject)) {
      throw new Error("Destinatário ou assunto do e-mail inválido.");
    }
    try {
      const result = await this.transport.sendMail({
        from: this.configuration.from,
        to: { name: message.to.name, address: message.to.email },
        subject: message.subject,
        html: message.html,
        text: message.text,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      const accepted = result.accepted.some((recipient) => recipient.toLowerCase() === message.to.email.toLowerCase());
      if (!accepted || result.rejected.length > 0) throw new Error("SMTP recusou o destinatário.");
      return { messageId: result.messageId };
    } catch {
      // Erros do provedor podem carregar o envelope ou credenciais; não repassar nem logar.
      throw new Error("O servidor SMTP não confirmou o envio do e-mail.");
    }
  }

  close(): void {
    this.transport.close();
  }

  private static readConfiguration(env: NodeJS.ProcessEnv): SmtpConfiguration {
    const host = env.SMTP_HOST?.trim();
    const address = env.SMTP_FROM_EMAIL?.trim();
    if (!host || !address || !EMAIL.test(address)) {
      throw new Error("Configure SMTP_HOST e SMTP_FROM_EMAIL antes de enviar e-mails.");
    }
    const secure = this.booleanSetting(env.SMTP_SECURE, env.SMTP_PORT === "465", "SMTP_SECURE");
    const port = Number(env.SMTP_PORT || (secure ? 465 : 587));
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("SMTP_PORT inválida.");
    if (port === 465 && !secure) throw new Error("SMTP_PORT 465 exige SMTP_SECURE=true.");
    const requireTLS = this.booleanSetting(env.SMTP_REQUIRE_TLS, true, "SMTP_REQUIRE_TLS");
    if (env.NODE_ENV !== "development" && !secure && !requireTLS) {
      throw new Error("SMTP em produção exige TLS.");
    }
    if (Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASSWORD)) {
      throw new Error("Configure SMTP_USER e SMTP_PASSWORD juntos.");
    }
    return {
      host,
      port,
      secure,
      requireTLS,
      from: { name: env.SMTP_FROM_NAME?.trim() || "Cub's", address },
      ...(env.SMTP_USER && env.SMTP_PASSWORD
        ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } }
        : {}),
    };
  }

  private static booleanSetting(value: string | undefined, fallback: boolean, name: string): boolean {
    if (value === undefined || value === "") return fallback;
    if (value === "true" || value === "1") return true;
    if (value === "false" || value === "0") return false;
    throw new Error(`${name} deve ser true ou false.`);
  }
}
