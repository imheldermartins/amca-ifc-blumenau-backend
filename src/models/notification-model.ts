import { schemaRegistry } from '@/db/rqlite.generated';
import type { Schema } from '@/db/schemas/index';
import { Model } from '@/repositories/model';

const notifications = new Model<Schema.Notification>(schemaRegistry.notifications);
const notificationDeliveries = new Model<Schema.NotificationDelivery>(
  schemaRegistry.notification_deliveries,
);

export { notifications, notificationDeliveries };
