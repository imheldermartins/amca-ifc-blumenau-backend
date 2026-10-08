import type { SMTPSentMessageInfo, Transporter } from "nodemailer";

export interface EmailAddress {
  name: string;
  email: string;
}

/** Conteúdo já resolvido pelo domínio/template. A camada de envio não o reescreve. */
export interface EmailContent {
  html: string;
  text?: string;
}

/** Envelope simples entregue por SendEmail ao adaptador SMTP. */
export interface EmailMessage {
  from: EmailAddress;
  to: EmailAddress;
  subject: string;
  content: EmailContent;
}

export type SendEmailInput = Omit<EmailMessage, "from">;

export interface EmailDeliveryReceipt {
  messageId: string;
}

export interface EmailDelivery {
  verify(): Promise<void>;
  deliver(message: EmailMessage): Promise<EmailDeliveryReceipt>;
  close(): void;
}

export interface SmtpConfiguration {
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  auth?: { user: string; pass: string };
}

export interface MailEnvironmentConfiguration {
  smtp: SmtpConfiguration;
  from: EmailAddress;
}

export type MailTransport = Pick<Transporter<SMTPSentMessageInfo>, "sendMail" | "verify" | "close">;

export interface EmailDraft {
  subject: string;
  content: EmailContent;
}

export type EmailFailureCode =
  | "configuration"
  | "invalid_message"
  | "authentication"
  | "connection"
  | "recipient_rejected"
  | "delivery";

export interface EmailFailureFeedback {
  code: EmailFailureCode;
  message: string;
  retryable: boolean;
}

export interface AccessInviteEmailInput {
  recipientEmail: string;
  scopeType: string;
  scopeName: string;
  authorName: string;
  roleName: string;
  inviteUrl: string;
  expiresAt: string | null;
}

export interface AccountVerificationEmailInput {
  name: string | null;
  email: string;
  verificationUrl: string;
}

export interface MembershipRequestEmailInput {
  recipient: { name: string; email: string };
  requester: { name: string; email: string };
  scopeName: string;
  scopeType: "Organização" | "Workspace" | "Página";
  reviewUrl: string;
}
