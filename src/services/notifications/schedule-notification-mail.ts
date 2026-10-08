import type { EmailDraft } from '@/services/mail/types/mail.types';

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[character]!);
}

function scheduleUrl(): string | null {
  const origin = process.env.APP_PUBLIC_URL?.trim();
  if (!origin) return null;
  try {
    return new URL('/pt-br/schedule', origin).toString();
  } catch {
    return null;
  }
}

function actionLink(label: string, url: string | null): { html: string; text: string } {
  if (!url) return { html: '', text: '' };
  const safeUrl = escapeHtml(url);
  return {
    html: `<p><a href="${safeUrl}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#7c3aed;color:#fff;text-decoration:none;font-weight:600">${escapeHtml(label)}</a></p>`,
    text: `\n${label}: ${url}`,
  };
}

export function schedulePinRequestMail(input: {
  recipient: { name: string; email: string };
  requesterName: string;
  pageTitle: string;
}): EmailDraft {
  const link = actionLink('Abrir notificações', scheduleUrl());
  const requester = escapeHtml(input.requesterName);
  const page = escapeHtml(input.pageTitle);
  return {
    subject: `${input.requesterName} quer adicionar uma página à sua agenda · Cub's`,
    content: {
      html: `<p>Olá, ${escapeHtml(input.recipient.name)}.</p><p><strong>${requester}</strong> solicitou que você fixe <strong>${page}</strong> na sua agenda.</p><p>A página não será alterada. Você pode aceitar ou recusar pelo Cub's.</p>${link.html}`,
      text: `Olá, ${input.recipient.name}.\n\n${input.requesterName} solicitou que você fixe ${input.pageTitle} na sua agenda. A página não será alterada. Você pode aceitar ou recusar pelo Cub's.${link.text}`,
    },
  };
}

export function scheduleReminderMail(input: {
  recipient: { name: string; email: string };
  pageTitle: string;
  start: string;
  allDay: boolean;
}): EmailDraft {
  const link = actionLink('Abrir agenda', scheduleUrl());
  const timing = input.allDay ? `hoje (${input.start.slice(0, 10)})` : input.start;
  return {
    subject: `Lembrete: ${input.pageTitle} · Cub's`,
    content: {
      html: `<p>Olá, ${escapeHtml(input.recipient.name)}.</p><p>O item fixado <strong>${escapeHtml(input.pageTitle)}</strong> começa ${escapeHtml(timing)}.</p>${link.html}`,
      text: `Olá, ${input.recipient.name}.\n\nO item fixado ${input.pageTitle} começa ${timing}.${link.text}`,
    },
  };
}
