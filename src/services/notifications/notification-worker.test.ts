import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NotificationStore } from '@/repositories/notification-repository';
import type { ScheduleStore } from '@/repositories/schedule-repository';
import type { EnqueueNotificationInput } from '@/repositories/types/notification-repository.types';
import type { ScheduleReminderCandidateRow } from '@/repositories/types/schedule-repository.types';
import type { PagePdfService } from '@/services/pages/page-pdf-service';

const mail = vi.hoisted(() => ({ send: vi.fn(), close: vi.fn() }));
vi.mock('@/services/mail/send-email', () => ({
  SendEmail: {
    fromEnvironment: () => ({ send: mail.send, close: mail.close }),
  },
  emailFailureFeedback: (error: { code?: string }) => ({
    code: error?.code ?? 'delivery',
    message: 'Falha segura',
    retryable: error?.code !== 'authentication',
  }),
}));

import { NotificationWorker } from './notification-worker.js';

const ids = {
  pin: '01K89WJ7X00000000000000010',
  workspace: '01K89WJ7X00000000000000011',
  page: '01K89WJ7X00000000000000012',
  user: '01K89WJ7X00000000000000013',
} as const;

const smtp = {
  host: process.env.SMTP_HOST,
  from: process.env.SMTP_FROM_EMAIL,
};

describe('Flow PDF attachment lifecycle', () => {
  it.each([
    { failure: false, includePageTitle: undefined }, { failure: true, includePageTitle: undefined },
    { failure: false, includePageTitle: false }, { failure: true, includePageTitle: false },
  ])('generates at delivery and wipes the buffer after SMTP (%o)', async ({ failure, includePageTitle }) => {
    process.env.SMTP_HOST = 'smtp.example.test'; process.env.SMTP_FROM_EMAIL = 'cubs@example.test';
    const buffer = Buffer.from('%PDF-sensitive');
    const pagePdf = { pageId: ids.page, templatePageId: ids.workspace, actorUserId: ids.user, ...(includePageTitle !== undefined && { includePageTitle }) };
    const notifications = { listDueDeliveries: vi.fn(async () => [{ id: ids.pin, attempts: 0, payload: JSON.stringify({ to: { name: 'Ana', email: 'ana@example.test' }, subject: 'PDF', content: { html: '<p>PDF</p>' }, pagePdf }) }]), claimDelivery: vi.fn(async () => true), markSent: vi.fn(), markFailed: vi.fn() } as unknown as NotificationStore;
    const schedule = { listReminderCandidates: vi.fn(async () => []) } as unknown as ScheduleStore;
    const pdfs = { generate: vi.fn(async () => ({ buffer, filename: 'pagina.pdf' })) } as unknown as PagePdfService;
    mail.send.mockImplementationOnce(async (payload) => {
      expect(payload.pagePdf).toBeUndefined();
      expect(payload.attachments[0].content.toString()).toBe('%PDF-sensitive');
      expect(payload.attachments[0].filename).toBe('pagina.pdf');
      if (failure) throw new Error('SMTP unavailable');
      return { messageId: 'sent' };
    });
    await new NotificationWorker(notifications, schedule, () => new Date(), pdfs).runOnce();
    expect(pdfs.generate).toHaveBeenCalledWith(ids.page, ids.user, ids.workspace, undefined, { includePageTitle: includePageTitle !== false });
    expect(buffer.every((byte) => byte === 0)).toBe(true);
    expect(failure ? notifications.markFailed : notifications.markSent).toHaveBeenCalledOnce();
  });
  it('never sends the mail when the attachment cannot be authorized or generated', async () => {
    process.env.SMTP_HOST = 'smtp.example.test'; process.env.SMTP_FROM_EMAIL = 'cubs@example.test';
    const notifications = { listDueDeliveries: vi.fn(async () => [{ id: ids.pin, attempts: 0, payload: JSON.stringify({ to: { name: 'Ana', email: 'ana@example.test' }, subject: 'PDF', content: { html: '<p>PDF</p>' }, pagePdf: { pageId: ids.page, actorUserId: ids.user } }) }]), claimDelivery: vi.fn(async () => true), markSent: vi.fn(), markFailed: vi.fn() } as unknown as NotificationStore;
    const schedule = { listReminderCandidates: vi.fn(async () => []) } as unknown as ScheduleStore;
    const pdfs = { generate: vi.fn(async () => { throw new Error('Forbidden'); }) } as unknown as PagePdfService;
    await new NotificationWorker(notifications, schedule, () => new Date(), pdfs).runOnce();
    expect(mail.send).not.toHaveBeenCalled(); expect(notifications.markFailed).toHaveBeenCalledOnce();
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  mail.send.mockResolvedValue({ messageId: 'mail-1' });
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_FROM_EMAIL;
});

afterEach(() => {
  if (smtp.host === undefined) delete process.env.SMTP_HOST;
  else process.env.SMTP_HOST = smtp.host;
  if (smtp.from === undefined) delete process.env.SMTP_FROM_EMAIL;
  else process.env.SMTP_FROM_EMAIL = smtp.from;
});

function candidate(date: string): ScheduleReminderCandidateRow {
  return {
    pin_id: ids.pin as NonEmptyString,
    pin_created_at: '2026-09-29T12:00:00.000Z',
    workspace_id: ids.workspace as NonEmptyString,
    page_id: ids.page as NonEmptyString,
    user_id: ids.user as NonEmptyString,
    user_name: 'Helena',
    user_email: 'helena@example.test',
    page_title: 'Reserva da sala',
    date_value_data: JSON.stringify({ value: date }),
  };
}

function setup(rows: ScheduleReminderCandidateRow[], readable = new Set<string>([ids.page])) {
  const enqueued: EnqueueNotificationInput[] = [];
  const notifications = {
    enqueue: vi.fn(async (input: EnqueueNotificationInput) => {
      enqueued.push(input);
      return true;
    }),
  } as unknown as NotificationStore;
  const schedule = {
    listReminderCandidates: vi.fn(async () => rows),
    listReadablePageIds: vi.fn(async () => readable),
  } as unknown as ScheduleStore;
  return { worker: new NotificationWorker(notifications, schedule), notifications, schedule, enqueued };
}

describe('NotificationWorker schedule reminders', () => {
  it('enqueues a date-only reminder at midnight with a stable dedupe key', async () => {
    const now = new Date('2026-10-01T00:00:00.000Z');
    const { worker, schedule, enqueued } = setup([candidate('2026-10-01')]);

    await worker.runOnce(now);

    expect(schedule.listReadablePageIds).toHaveBeenCalledWith(ids.user, [ids.page]);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({
      workspaceId: ids.workspace,
      recipientUserId: ids.user,
      actorUserId: null,
      type: 'schedule_event_reminder',
      resourceType: 'page',
      resourceId: ids.page,
      dedupeKey: `schedule-reminder:${ids.pin}:2026-10-01T00:00:00.000Z`,
      data: {
        pageId: ids.page,
        pageTitle: 'Reserva da sala',
        start: '2026-10-01',
        allDay: true,
      },
      email: { to: { name: 'Helena', email: 'helena@example.test' } },
    });
  });

  it('skips inaccessible pages, future events and pins created after the event', async () => {
    const now = new Date('2026-10-01T12:00:00.000Z');
    const future = candidate('2026-10-01T13:00:00.000Z');
    const inaccessible = { ...candidate('2026-10-01T11:00:00.000Z'), page_id: '01K89WJ7X00000000000000014' as NonEmptyString };
    const latePin = { ...candidate('2026-10-01T10:00:00.000Z'), pin_created_at: '2026-10-01T11:00:00.000Z' };
    const { worker, enqueued } = setup([future, inaccessible, latePin]);

    await worker.runOnce(now);

    expect(enqueued).toEqual([]);
  });

  it('entrega payload novo e converte a outbox legada pela camada SendEmail', async () => {
    process.env.SMTP_HOST = 'smtp.example.test';
    process.env.SMTP_FROM_EMAIL = 'cubs@example.test';
    const nested = {
      to: { name: 'Helena', email: 'helena@example.test' },
      subject: 'Novo',
      content: { html: '<p>Novo</p>', text: 'Novo' },
    };
    const legacy = {
      to: { name: 'Helena', email: 'helena@example.test' },
      subject: 'Legado',
      html: '<p>Legado</p>',
      text: 'Legado',
    };
    const deliveries = [nested, legacy].map((payload, index) => ({
      id: `01K89WJ7X0000000000000002${index}` as NonEmptyString,
      notification_id: `01K89WJ7X0000000000000003${index}` as NonEmptyString,
      channel: 'email' as const,
      status: 'pending' as const,
      attempts: 0,
      payload: JSON.stringify(payload),
      next_attempt_at: null,
      locked_at: null,
      sent_at: null,
      provider_message_id: null,
      last_error: null,
      created_at: '2026-10-01T00:00:00.000Z',
      updated_at: '2026-10-01T00:00:00.000Z',
    }));
    const notifications = {
      enqueue: vi.fn(),
      listDueDeliveries: vi.fn(async () => deliveries),
      claimDelivery: vi.fn(async () => true),
      markSent: vi.fn(async () => undefined),
      markFailed: vi.fn(async () => undefined),
    } as unknown as NotificationStore;
    const schedule = {
      listReminderCandidates: vi.fn(async () => []),
      listReadablePageIds: vi.fn(),
    } as unknown as ScheduleStore;

    await new NotificationWorker(notifications, schedule).runOnce(new Date('2026-10-01T12:00:00.000Z'));

    expect(mail.send).toHaveBeenNthCalledWith(1, nested);
    expect(mail.send).toHaveBeenNthCalledWith(2, {
      to: legacy.to,
      subject: legacy.subject,
      content: { html: legacy.html, text: legacy.text },
    });
    expect(notifications.markSent).toHaveBeenCalledTimes(2);
    expect(mail.close).toHaveBeenCalledOnce();
  });

  it('persiste o código seguro da falha de credenciais para feedback da entrega', async () => {
    process.env.SMTP_HOST = 'smtp.example.test';
    process.env.SMTP_FROM_EMAIL = 'cubs@example.test';
    mail.send.mockRejectedValueOnce({ code: 'authentication' });
    const row = {
      id: '01K89WJ7X00000000000000020' as NonEmptyString,
      attempts: 1,
      payload: JSON.stringify({
        to: { name: 'Helena', email: 'helena@example.test' },
        subject: 'Teste',
        content: { html: '<p>Teste</p>' },
      }),
    };
    const notifications = {
      enqueue: vi.fn(),
      listDueDeliveries: vi.fn(async () => [row]),
      claimDelivery: vi.fn(async () => true),
      markSent: vi.fn(),
      markFailed: vi.fn(async () => undefined),
    } as unknown as NotificationStore;
    const schedule = {
      listReminderCandidates: vi.fn(async () => []),
      listReadablePageIds: vi.fn(),
    } as unknown as ScheduleStore;

    await new NotificationWorker(notifications, schedule).runOnce(new Date('2026-10-01T12:00:00.000Z'));

    expect(notifications.markFailed).toHaveBeenCalledWith(
      row.id,
      expect.any(String),
      'authentication',
    );
    expect(notifications.markSent).not.toHaveBeenCalled();
  });
});
