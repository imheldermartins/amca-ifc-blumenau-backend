import { Template } from "@/services/mail/template";
import { validateEmailActionUrl } from "@/services/mail/email-action-url";
import type { AccessInviteEmailInput, MailMessage } from "@/services/mail/types/mail.types";

export class AccessInviteEmail {
  private readonly template = Template.fromFiles<{
    scope_type: string;
    scope_name: string;
    author_name: string;
    role_name: string;
    recipient_email: string;
    invite_url: string;
    expiry_text: string;
  }>({
    subject: "Convite para {{scope_name}} · Cub's",
    html: new URL("./templates/access-invite.html", import.meta.url),
    text: new URL("./templates/access-invite.txt", import.meta.url),
  });

  public create(input: AccessInviteEmailInput): MailMessage {
    const body = this.template.render({
      scope_type: input.scopeType,
      scope_name: input.scopeName,
      author_name: input.authorName,
      role_name: input.roleName,
      recipient_email: input.recipientEmail,
      invite_url: validateEmailActionUrl(input.inviteUrl),
      expiry_text: input.expiresAt
        ? `Válido até ${new Date(input.expiresAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.`
        : "Este link não tem prazo de expiração.",
    });
    return {
      to: { name: input.recipientEmail, email: input.recipientEmail },
      subject: body.subject,
      html: body.bodyHtml,
      text: body.bodyText,
    };
  }
}

export const accessInviteEmail = new AccessInviteEmail();
