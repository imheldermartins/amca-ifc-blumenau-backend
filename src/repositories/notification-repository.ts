import { rqlite } from '@/db/client-db';
import db from '@models/index';
import type {
  EnqueueNotificationInput,
  NotificationDeliveryRow,
  NotificationRow,
} from '@/repositories/types/notification-repository.types';

/** SQL genérico de notificações/outbox. Domínios apenas fornecem tipo e payload. */
export class NotificationStore {
  public list(
    workspaceId: NonEmptyString,
    recipientUserId: NonEmptyString,
  ): Promise<NotificationRow[]> {
    const text = `SELECT notification.*,
      actor.name AS actor_name,
      actor.email AS actor_email
    FROM notifications notification
    LEFT JOIN users actor ON actor.id = notification.actor_user_id
    WHERE notification.workspace_id = ?
      AND notification.recipient_user_id = ?
    ORDER BY notification.read_at IS NULL DESC, notification.created_at DESC, notification.id DESC
    LIMIT 100`;
    return db.sqlRaw<NotificationRow>({
      text,
      values: [workspaceId, recipientUserId],
    }, 'query');
  }

  public async markRead(
    workspaceId: NonEmptyString,
    recipientUserId: NonEmptyString,
    notificationId: NonEmptyString,
  ): Promise<boolean> {
    const rows = await db.sqlRaw<{ id: string }>({
      text: `UPDATE notifications
        SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND workspace_id = ? AND recipient_user_id = ?
        RETURNING id`,
      values: [notificationId, workspaceId, recipientUserId],
    }, 'request');
    return rows.length === 1;
  }

  /** Idempotente por dedupeKey; a entrega usa a mesma identidade canônica. */
  public async enqueue(input: EnqueueNotificationInput): Promise<boolean> {
    const results = await rqlite([
      [`INSERT OR IGNORE INTO notifications (
        id, workspace_id, recipient_user_id, actor_user_id, type,
        resource_type, resource_id, data, dedupe_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.id,
      input.workspaceId,
      input.recipientUserId,
      input.actorUserId,
      input.type,
      input.resourceType,
      input.resourceId,
      JSON.stringify(input.data),
      input.dedupeKey],
      [`INSERT OR IGNORE INTO notification_deliveries (
        id, notification_id, channel, status, payload
      ) SELECT ?, notification.id, 'email', 'pending', ?
        FROM notifications notification WHERE notification.dedupe_key = ?`,
      input.deliveryId,
      JSON.stringify(input.email),
      input.dedupeKey],
    ], 'execute', { transaction: true });
    return results.length === 2 && results.every(Boolean);
  }

  public listDueDeliveries(
    now: string,
    staleBefore: string,
    limit = 25,
  ): Promise<NotificationDeliveryRow[]> {
    const text = `SELECT * FROM notification_deliveries
      WHERE (
        status IN ('pending','failed')
        AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
      ) OR (
        status = 'processing'
        AND locked_at IS NOT NULL
        AND locked_at <= ?
      )
      ORDER BY COALESCE(next_attempt_at, created_at), id
      LIMIT ?`;
    return db.sqlRaw<NotificationDeliveryRow>({
      text,
      values: [now, staleBefore, limit],
    }, 'query');
  }

  public async claimDelivery(id: NonEmptyString, now: string, staleBefore: string): Promise<boolean> {
    const rows = await db.sqlRaw<{ id: string }>({
      text: `UPDATE notification_deliveries
        SET status = 'processing', locked_at = ?, attempts = attempts + 1,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND (
          (status IN ('pending','failed') AND (next_attempt_at IS NULL OR next_attempt_at <= ?))
          OR (status = 'processing' AND locked_at IS NOT NULL AND locked_at <= ?)
        )
        RETURNING id`,
      values: [now, id, now, staleBefore],
    }, 'request');
    return rows.length === 1;
  }

  public async markSent(id: NonEmptyString, providerMessageId: string): Promise<void> {
    await db.sqlRaw({
      text: `UPDATE notification_deliveries
        SET status = 'sent', sent_at = CURRENT_TIMESTAMP, provider_message_id = ?,
          last_error = NULL, locked_at = NULL, next_attempt_at = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'processing'`,
      values: [providerMessageId, id],
    }, 'execute');
  }

  public async markFailed(id: NonEmptyString, nextAttemptAt: string): Promise<void> {
    await db.sqlRaw({
      text: `UPDATE notification_deliveries
        SET status = 'failed', last_error = 'delivery_failed', locked_at = NULL,
          next_attempt_at = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'processing'`,
      values: [nextAttemptAt, id],
    }, 'execute');
  }
}

export default new NotificationStore();
