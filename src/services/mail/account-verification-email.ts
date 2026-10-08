import { Template } from "@/services/mail/template";
import { validateEmailActionUrl } from "@/services/mail/email-action-url";
import type { AccountVerificationEmailInput, EmailDraft } from "@/services/mail/types/mail.types";

export class AccountVerificationEmail {
  private readonly template = Template.fromFiles<{
    recipient_name: string;
    recipient_email: string;
    verification_url: string;
  }>({
    subject: "Valide seu e-mail no Cub's",
    html: new URL("./templates/verify-account.html", import.meta.url),
    text: new URL("./templates/verify-account.txt", import.meta.url),
  });

  public create(input: AccountVerificationEmailInput): EmailDraft {
    const recipient = { name: input.name?.trim() || input.email, email: input.email };
    return this.template.render({
      recipient_name: recipient.name,
      recipient_email: recipient.email,
      verification_url: validateEmailActionUrl(input.verificationUrl),
    });
  }
}

export const accountVerificationEmail = new AccountVerificationEmail();
