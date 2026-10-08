import nodemailer from "nodemailer";
import { EmailDeliveryError, smtpProviderFailure } from "@/services/mail/mail-error";
import type {
  EmailDelivery,
  EmailDeliveryReceipt,
  EmailMessage,
  MailEnvironmentConfiguration,
  MailTransport,
  SmtpConfiguration,
} from "@/services/mail/types/mail.types";

export type {
  MailEnvironmentConfiguration,
  MailTransport,
  SmtpConfiguration,
} from "@/services/mail/types/mail.types";

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/** Adaptador de entrega: conhece Nodemailer, conexão, aceitação e falhas do provedor. */
export class Smtp implements EmailDelivery {
  private readonly transport: MailTransport;

  constructor(configuration: SmtpConfiguration, transport?: MailTransport) {
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

  public static configurationFromEnvironment(
    env: NodeJS.ProcessEnv = process.env,
  ): MailEnvironmentConfiguration {
    const host = env.SMTP_HOST?.trim();
    const email = env.SMTP_FROM_EMAIL?.trim();
    if (!host || !email || !EMAIL.test(email)) {
      throw new EmailDeliveryError(
        "configuration",
        "Configure SMTP_HOST e SMTP_FROM_EMAIL com valores válidos.",
      );
    }
    const secure = this.booleanSetting(env.SMTP_SECURE, env.SMTP_PORT === "465", "SMTP_SECURE");
    const port = Number(env.SMTP_PORT || (secure ? 465 : 587));
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new EmailDeliveryError("configuration", "SMTP_PORT é inválida.");
    }
    if (port === 465 && !secure) {
      throw new EmailDeliveryError("configuration", "SMTP_PORT 465 exige SMTP_SECURE=true.");
    }
    const requireTLS = this.booleanSetting(env.SMTP_REQUIRE_TLS, true, "SMTP_REQUIRE_TLS");
    if (env.NODE_ENV !== "development" && !secure && !requireTLS) {
      throw new EmailDeliveryError("configuration", "SMTP em produção exige TLS.");
    }
    if (Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASSWORD)) {
      throw new EmailDeliveryError(
        "configuration",
        "Configure SMTP_USER e SMTP_PASSWORD juntos.",
      );
    }
    return {
      smtp: {
        host,
        port,
        secure,
        requireTLS,
        ...(env.SMTP_USER && env.SMTP_PASSWORD
          ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } }
          : {}),
      },
      from: { name: env.SMTP_FROM_NAME?.trim() || "Cub's", email },
    };
  }

  public async verify(): Promise<void> {
    try {
      await this.transport.verify();
    } catch (error) {
      throw smtpProviderFailure(error);
    }
  }

  public async deliver(message: EmailMessage): Promise<EmailDeliveryReceipt> {
    try {
      const result = await this.transport.sendMail({
        from: { name: message.from.name, address: message.from.email },
        to: { name: message.to.name, address: message.to.email },
        subject: message.subject,
        html: message.content.html,
        ...(message.content.text !== undefined ? { text: message.content.text } : {}),
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      const recipient = message.to.email.toLowerCase();
      const accepted = result.accepted.some((value) => String(value).toLowerCase() === recipient);
      if (!accepted || result.rejected.length > 0) {
        throw new EmailDeliveryError("recipient_rejected");
      }
      return { messageId: result.messageId };
    } catch (error) {
      throw smtpProviderFailure(error);
    }
  }

  public close(): void {
    this.transport.close();
  }

  private static booleanSetting(
    value: string | undefined,
    fallback: boolean,
    name: string,
  ): boolean {
    if (value === undefined || value === "") return fallback;
    if (value === "true" || value === "1") return true;
    if (value === "false" || value === "0") return false;
    throw new EmailDeliveryError("configuration", `${name} deve ser true ou false.`);
  }
}
