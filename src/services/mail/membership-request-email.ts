import { Template } from "@/services/mail/template";
import { validateEmailActionUrl } from "@/services/mail/email-action-url";
import type { EmailDraft, MembershipRequestEmailInput } from "@/services/mail/types/mail.types";

export class MembershipRequestEmail {
  private readonly template = Template.fromFiles<{
    recipient_name: string;
    recipient_email: string;
    requester_name: string;
    requester_email: string;
    scope_name: string;
    scope_type: string;
    review_url: string;
  }>({
    subject: "Solicitação de acesso a {{scope_name}} · Cub's",
    html: new URL("./templates/membership-request.html", import.meta.url),
    text: new URL("./templates/membership-request.txt", import.meta.url),
  });

  public create(input: MembershipRequestEmailInput): EmailDraft {
    return this.template.render({
      recipient_name: input.recipient.name,
      recipient_email: input.recipient.email,
      requester_name: input.requester.name,
      requester_email: input.requester.email,
      scope_name: input.scopeName,
      scope_type: input.scopeType,
      review_url: validateEmailActionUrl(input.reviewUrl),
    });
  }
}

export const membershipRequestEmail = new MembershipRequestEmail();
