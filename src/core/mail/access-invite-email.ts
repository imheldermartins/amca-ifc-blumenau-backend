import type { MailMessage } from './smtp-service.js';
import { Template } from './template.js';
import { validateEmailActionUrl } from './email-action-url.js';

const template = Template.fromFiles<{
  scope_type: string; scope_name: string; author_name: string; role_name: string;
  recipient_email: string; invite_url: string; expiry_text: string;
}>({
  subject: "Convite para {{scope_name}} · Cub's",
  html: new URL('./templates/access-invite.html', import.meta.url),
  text: new URL('./templates/access-invite.txt', import.meta.url),
});

export function accessInviteEmail(input: {
  recipientEmail: string; scopeType: string; scopeName: string; authorName: string;
  roleName: string; inviteUrl: string; expiresAt: string | null;
}): MailMessage {
  const body = template.render({
    scope_type: input.scopeType,
    scope_name: input.scopeName,
    author_name: input.authorName,
    role_name: input.roleName,
    recipient_email: input.recipientEmail,
    invite_url: validateEmailActionUrl(input.inviteUrl),
    expiry_text: input.expiresAt
      ? `Válido até ${new Date(input.expiresAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`
      : 'Este link não tem prazo de expiração.',
  });
  return {
    to: { name: input.recipientEmail, email: input.recipientEmail },
    subject: body.subject,
    html: body.bodyHtml,
    text: body.bodyText,
  };
}
