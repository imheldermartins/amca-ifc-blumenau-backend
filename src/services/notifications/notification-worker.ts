import { ulid } from 'ulid';

import notificationStore, { NotificationStore } from '@/repositories/notification-repository';
import scheduleStore, { ScheduleStore } from '@/repositories/schedule-repository';
import type { EmailOutboxPayload } from '@/repositories/types/notification-repository.types';
import { scheduleReminderMail } from '@/services/notifications/schedule-notification-mail';
import { emailFailureFeedback, SendEmail } from '@/services/mail/send-email';
import { projectScheduleInterval, scheduleStartInstant } from '@/services/schedule/schedule-date';
import { VALUE_CODECS } from '@/services/value-codec';

const DAY_MS = 24 * 60 * 60 * 1_000;
const STALE_LOCK_MS = 10 * 60 * 1_000;
const SQLITE_UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{3})?$/;

function timestampMs(value: string): number {
  const normalized = SQLITE_UTC_TIMESTAMP.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  return new Date(normalized).getTime();
}

function emailPayload(value: unknown): EmailOutboxPayload | null {
  let parsed = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { return null; }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const payload = parsed as Partial<EmailOutboxPayload>;
  if (!payload.to || typeof payload.to.name !== 'string' || typeof payload.to.email !== 'string'
    || typeof payload.subject !== 'string') return null;
  if (payload.content && typeof payload.content.html === 'string'
    && (payload.content.text === undefined || typeof payload.content.text === 'string')) {
    return payload as EmailOutboxPayload;
  }
  // Compatibilidade com entregas persistidas antes da introdução de `content`.
  const legacy = parsed as { html?: unknown; text?: unknown };
  if (typeof legacy.html !== 'string' || typeof legacy.text !== 'string') return null;
  return {
    to: payload.to,
    subject: payload.subject,
    content: { html: legacy.html, text: legacy.text },
  };
}

function retryAt(now: Date, attempt: number): string {
  const delayMinutes = Math.min(24 * 60, 2 ** Math.min(attempt, 10));
  return new Date(now.getTime() + delayMinutes * 60_000).toISOString();
}

/**
 * Worker leve para o deploy single-instance atual. A criação in-app e a outbox
 * são duráveis; indisponibilidade SMTP só posterga o canal de e-mail.
 */
export class NotificationWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  public constructor(
    private readonly notifications: NotificationStore = notificationStore,
    private readonly schedule: ScheduleStore = scheduleStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public start(): void {
    if (this.timer || process.env.NODE_ENV === 'test') return;
    const configured = Number(process.env.NOTIFICATION_POLL_INTERVAL_MS ?? 60_000);
    const interval = Number.isFinite(configured) ? Math.max(10_000, configured) : 60_000;
    void this.tick();
    this.timer = setInterval(() => { void this.tick(); }, interval);
    this.timer.unref();
  }

  public stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  public async runOnce(at = this.now()): Promise<void> {
    await this.enqueueDueScheduleReminders(at);
    await this.deliverPendingEmails(at);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.runOnce();
    } catch (error) {
      if (error instanceof Error) console.error(`[NOTIFICATION_WORKER] ${error.message}`);
    } finally {
      this.running = false;
    }
  }

  private async enqueueDueScheduleReminders(now: Date): Promise<void> {
    const candidates = await this.schedule.listReminderCandidates();
    const lowerBound = now.getTime() - DAY_MS;
    const byUser = new Map<string, typeof candidates>();
    for (const candidate of candidates) {
      const group = byUser.get(candidate.user_id) ?? [];
      group.push(candidate);
      byUser.set(candidate.user_id, group);
    }

    for (const [userId, userCandidates] of byUser) {
      const visible = await this.schedule.listReadablePageIds(
        userId as NonEmptyString,
        userCandidates.map((candidate) => candidate.page_id),
      );
      for (const candidate of userCandidates) {
        if (!visible.has(candidate.page_id)) continue;
        let raw: unknown;
        try { raw = VALUE_CODECS.date.decode(candidate.date_value_data); } catch { continue; }
        if (typeof raw !== 'string') continue;
        const start = scheduleStartInstant(raw);
        const interval = projectScheduleInterval(raw);
        if (!start || !interval) continue;
        const due = start.getTime();
        // SQLite CURRENT_TIMESTAMP não inclui offset, embora represente UTC.
        // Normalizar explicitamente evita comparar como horário local do host.
        const pinnedAt = timestampMs(candidate.pin_created_at);
        if (due > now.getTime() || due < lowerBound || (!Number.isNaN(pinnedAt) && pinnedAt > due)) continue;

        const title = candidate.page_title ?? 'Sem título';
        const dedupeKey = `schedule-reminder:${candidate.pin_id}:${start.toISOString()}`;
        const recipient = {
          name: candidate.user_name || candidate.user_email,
          email: candidate.user_email,
        };
        await this.notifications.enqueue({
          id: ulid() as NonEmptyString,
          deliveryId: ulid() as NonEmptyString,
          workspaceId: candidate.workspace_id,
          recipientUserId: candidate.user_id,
          actorUserId: null,
          type: 'schedule_event_reminder',
          resourceType: 'page',
          resourceId: candidate.page_id,
          data: {
            pageId: candidate.page_id,
            pageTitle: title,
            start: interval.start,
            allDay: interval.allDay,
          },
          dedupeKey,
          email: {
            to: recipient,
            ...scheduleReminderMail({
              recipient,
              pageTitle: title,
              start: interval.start,
              allDay: interval.allDay,
            }),
          },
        });
      }
    }
  }

  private async deliverPendingEmails(now: Date): Promise<void> {
    // Mantém a outbox pendente em ambientes sem SMTP, sem prejudicar o app.
    if (!process.env.SMTP_HOST?.trim() || !process.env.SMTP_FROM_EMAIL?.trim()) return;
    const staleBefore = new Date(now.getTime() - STALE_LOCK_MS).toISOString();
    const rows = await this.notifications.listDueDeliveries(now.toISOString(), staleBefore);
    if (!rows.length) return;
    const emailSender = SendEmail.fromEnvironment();
    try {
      for (const row of rows) {
        const claimed = await this.notifications.claimDelivery(
          row.id,
          now.toISOString(),
          staleBefore,
        );
        if (!claimed) continue;
        const payload = emailPayload(row.payload);
        if (!payload) {
          await this.notifications.markFailed(
            row.id,
            retryAt(now, row.attempts + 1),
            'invalid_message',
          );
          continue;
        }
        try {
          const sent = await emailSender.send(payload);
          await this.notifications.markSent(row.id, sent.messageId);
        } catch (error) {
          const failure = emailFailureFeedback(error);
          await this.notifications.markFailed(
            row.id,
            retryAt(now, row.attempts + 1),
            failure.code,
          );
        }
      }
    } finally {
      emailSender.close();
    }
  }
}

export default new NotificationWorker();
