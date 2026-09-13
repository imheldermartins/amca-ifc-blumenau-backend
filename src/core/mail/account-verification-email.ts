import type { MailMessage } from './smtp-service.js';
import { Template } from './template.js';
import { validateEmailActionUrl } from './email-action-url.js';

const template = Template.fromFiles<{
  recipient_name: string; recipient_email: string; verification_url: string;
}>({
  subject: "Valide seu e-mail no Cub's",
  html: new URL('./templates/verify-account.html', import.meta.url),
  text: new URL('./templates/verify-account.txt', import.meta.url),
});

export function accountVerificationEmail(input: {
  name: string | null; email: string; verificationUrl: string;
}): MailMessage {
  const recipient = { name: input.name?.trim() || input.email, email: input.email };
  const body = template.render({
    recipient_name: recipient.name,
    recipient_email: recipient.email,
    verification_url: validateEmailActionUrl(input.verificationUrl),
  });
  return { to: recipient, subject: body.subject, html: body.bodyHtml, text: body.bodyText };
}
