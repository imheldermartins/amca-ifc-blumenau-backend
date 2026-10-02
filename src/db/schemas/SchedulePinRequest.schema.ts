import {Table,Column,Default,ForeignKey,Check,Index} from '@cubs/rqlite-client/schema';
import {BaseSchema} from './Base.schema.js';

@Table('schedule_pin_requests')
@Check("status IN ('pending','accepted','declined','canceled')")
@ForeignKey({"columns":["workspace_id"],"table":"workspaces","references":["id"]})
@ForeignKey({"columns":["page_id"],"table":"pages","references":["id"]})
@ForeignKey({"columns":["requested_by_user_id"],"table":"users","references":["id"]})
@ForeignKey({"columns":["recipient_user_id"],"table":"users","references":["id"]})
@ForeignKey({"columns":["date_column_id"],"table":"page_columns","references":["id"]})
@ForeignKey({"columns":["color_column_id"],"table":"page_columns","references":["id"]})
@Index("idx_schedule_pin_requests_recipient_status", ["recipient_user_id","status","created_at"])
@Index("idx_schedule_pin_requests_pending_unique", ["workspace_id","recipient_user_id","page_id"], {"unique":true,"where":"status = 'pending'"})
export class SchedulePinRequestSchema extends BaseSchema {
  @Column()
  workspace_id!: string;

  @Column()
  page_id!: string;

  @Column()
  requested_by_user_id!: string;

  @Column()
  recipient_user_id!: string;

  @Column()
  date_column_id!: string;

  @Column() @Default(null)
  color_column_id!: string | null;

  @Column() @Default('pending')
  status!: string;

  @Column() @Default(null)
  decided_at!: string | null;
}
