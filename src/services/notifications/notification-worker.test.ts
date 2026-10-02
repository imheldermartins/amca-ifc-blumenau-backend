import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NotificationStore } from '@/repositories/notification-repository';
import type { ScheduleStore } from '@/repositories/schedule-repository';
import type { EnqueueNotificationInput } from '@/repositories/types/notification-repository.types';
import type { ScheduleReminderCandidateRow } from '@/repositories/types/schedule-repository.types';

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

beforeEach(() => {
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
});
