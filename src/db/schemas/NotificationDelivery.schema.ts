import {Table,Column,Default,Integer,Json,ForeignKey,Check,Index} from '@cubs/rqlite-client/schema';
import {BaseSchema} from './Base.schema.js';

/** Outbox durável. Persistir a notificação não depende da disponibilidade SMTP. */
@Table('notification_deliveries')
@Check("channel IN ('email')")
@Check("status IN ('pending','processing','sent','failed')")
@Check("attempts >= 0")
@ForeignKey({"columns":["notification_id"],"table":"notifications","references":["id"]})
@Index("idx_notification_deliveries_notification_channel", ["notification_id","channel"], {"unique":true})
@Index("idx_notification_deliveries_due", ["status","next_attempt_at"])
export class NotificationDeliverySchema extends BaseSchema {
  @Column()
  notification_id!: string;

  @Column() @Default('email')
  channel!: string;

  @Column() @Default('pending')
  status!: string;

  @Column() @Integer() @Default(0)
  attempts!: number;

  @Column() @Json() @Default("{}")
  payload!: Record<string, unknown>;

  @Column() @Default(null)
  next_attempt_at!: string | null;

  @Column() @Default(null)
  locked_at!: string | null;

  @Column() @Default(null)
  sent_at!: string | null;

  @Column() @Default(null)
  provider_message_id!: string | null;

  @Column() @Default(null)
  last_error!: string | null;
}
