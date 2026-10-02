import {Table,Column,Default,Json,ForeignKey,Index} from '@cubs/rqlite-client/schema';
import {BaseSchema} from './Base.schema.js';

/**
 * Fato visível para um usuário. O payload específico vive em `data`, enquanto
 * entrega por e-mail (ou canais futuros) fica isolada na outbox.
 */
@Table('notifications')
@ForeignKey({"columns":["workspace_id"],"table":"workspaces","references":["id"]})
@ForeignKey({"columns":["recipient_user_id"],"table":"users","references":["id"]})
@ForeignKey({"columns":["actor_user_id"],"table":"users","references":["id"]})
@Index("idx_notifications_recipient_workspace_created", ["recipient_user_id","workspace_id","created_at"])
@Index("idx_notifications_dedupe_key", ["dedupe_key"], {"unique":true})
export class NotificationSchema extends BaseSchema {
  @Column()
  workspace_id!: string;

  @Column() @Default(null)
  recipient_user_id!: string | null;

  @Column() @Default(null)
  actor_user_id!: string | null;

  @Column()
  type!: string;

  @Column()
  resource_type!: string;

  @Column()
  resource_id!: string;

  @Column() @Json() @Default("{}")
  data!: Record<string, unknown>;

  @Column()
  dedupe_key!: string;

  @Column() @Default(null)
  read_at!: string | null;
}
