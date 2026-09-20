import type { SMTPSentMessageInfo, Transporter } from "nodemailer";

export interface MailMessage {
  to: { name: string; email: string };
  subject: string;
  html: string;
  text: string;
}

export interface SmtpConfiguration {
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  from: { name: string; address: string };
  auth?: { user: string; pass: string };
}

export type MailTransport = Pick<Transporter<SMTPSentMessageInfo>, "sendMail" | "verify" | "close">;

export interface EmailBody {
  subject: string;
  bodyHtml: string;
  bodyText: string;
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
