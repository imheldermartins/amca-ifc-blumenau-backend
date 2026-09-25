import {Table,Column,Default,Json,ForeignKey,Check,Index} from '@cubs/rqlite-client/schema';
import {BaseSchema} from './Base.schema.js';

@Table('page_pending_requests', {softDelete: 'deleted_at'})
@Check("json_valid(notified_emails)")
@Check("status IN ('pending','accepted','rejected','canceled','expired')")
@ForeignKey({"columns":["role_id","page_id"],"table":"page_roles","references":["id","page_id"]})
@ForeignKey({"columns":["decided_by"],"table":"users","references":["id"]})
@ForeignKey({"columns":["accepted_by"],"table":"users","references":["id"]})
@ForeignKey({"columns":["requester_id"],"table":"users","references":["id"]})
@ForeignKey({"columns":["page_id"],"table":"pages","references":["id"]})
@Index("idx_page_pending_requests_open", ["page_id","requester_id"], {"unique":true,"where":"status = 'pending' AND deleted_at IS NULL"})
export class PagePendingRequestSchema extends BaseSchema {
  @Column()
  page_id!: string;

  @Column()
  requester_id!: string;

  @Column() @Json() @Default("[]")
  notified_emails!: Record<string, unknown> | unknown[];

  @Column() @Default("pending")
  status!: string;

  @Column() @Default(null)
  accepted_by!: string | null;

  @Column() @Default(null)
  decided_by!: string | null;

  @Column() @Default(null)
  decided_at!: string | null;

  @Column() @Default(null)
  role_id!: string | null;

  @Column() @Default(null)
  deleted_at!: string | null;
}
