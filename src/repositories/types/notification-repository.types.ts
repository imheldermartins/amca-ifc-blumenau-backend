import type { Schema } from '@/db/schemas/index';

export interface NotificationRow extends Omit<Schema.Notification, 'data'> {
  data: string;
  actor_name: string | null;
  actor_email: string | null;
}

export interface EmailOutboxPayload {
  to: { name: string; email: string };
  subject: string;
  html: string;
  text: string;
}

export interface NotificationDeliveryRow extends Omit<Schema.NotificationDelivery, 'payload'> {
  payload: string;
}

export interface EnqueueNotificationInput {
  id: NonEmptyString;
  deliveryId: NonEmptyString;
  workspaceId: NonEmptyString;
  recipientUserId: NonEmptyString;
  actorUserId: NonEmptyString | null;
  type: Schema.NotificationType;
  resourceType: Schema.NotificationResourceType;
  resourceId: NonEmptyString;
  data: Record<string, unknown>;
  dedupeKey: string;
  email: EmailOutboxPayload;
}
