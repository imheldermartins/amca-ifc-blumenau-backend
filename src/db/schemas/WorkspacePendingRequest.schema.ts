import {Table,Column,Default,Json,ForeignKey,Check,Index} from '@cubs/rqlite-client/schema';
import {BaseSchema} from './Base.schema.js';

@Table('workspace_pending_requests', {softDelete: 'deleted_at'})
@Check("json_valid(notified_emails)")
@Check("status IN ('pending','accepted','rejected','canceled','expired')")
@ForeignKey({"columns":["role_id","workspace_id"],"table":"workspace_roles","references":["id","workspace_id"]})
@ForeignKey({"columns":["decided_by"],"table":"users","references":["id"]})
@ForeignKey({"columns":["accepted_by"],"table":"users","references":["id"]})
@ForeignKey({"columns":["requester_id"],"table":"users","references":["id"]})
@ForeignKey({"columns":["workspace_id"],"table":"workspaces","references":["id"]})
@Index("idx_workspace_pending_requests_open", ["workspace_id","requester_id"], {"unique":true,"where":"status = 'pending' AND deleted_at IS NULL"})
export class WorkspacePendingRequestSchema extends BaseSchema {
  @Column()
  workspace_id!: string;

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
