import type { MailMessage } from "./smtp-service.js";
import { Template } from "./template.js";
import { validateEmailActionUrl } from "./email-action-url.js";

export interface MembershipRequestEmailInput {
  recipient: { name: string; email: string };
  requester: { name: string; email: string };
  scopeName: string;
  scopeType: "Organização" | "Workspace" | "Página";
  reviewUrl: string;
}

const template = Template.fromFiles<{
  recipient_name: string; recipient_email: string;
  requester_name: string; requester_email: string;
  scope_name: string; scope_type: string; review_url: string;
}>({
  subject: "Solicitação de acesso a {{scope_name}} · Cub's",
  html: new URL("./templates/membership-request.html", import.meta.url),
  text: new URL("./templates/membership-request.txt", import.meta.url),
});

export function membershipRequestEmail(input: MembershipRequestEmailInput): MailMessage {
  const body = template.render({
    recipient_name: input.recipient.name,
    recipient_email: input.recipient.email,
    requester_name: input.requester.name,
    requester_email: input.requester.email,
    scope_name: input.scopeName,
    scope_type: input.scopeType,
    review_url: validateEmailActionUrl(input.reviewUrl),
  });
  return { to: input.recipient, subject: body.subject, html: body.bodyHtml, text: body.bodyText };
}
