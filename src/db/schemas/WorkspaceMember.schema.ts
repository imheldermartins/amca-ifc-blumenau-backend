import {Table,Column,Default,ForeignKey,Unique,Index} from '@cubs/rqlite-client/schema';
import {BaseSchema} from './Base.schema.js';

@Table('workspace_members', {softDelete: 'deleted_at'})
@ForeignKey({"columns":["workspace_member_role_id","workspace_id"],"table":"workspace_roles","references":["id","workspace_id"]})
@ForeignKey({"columns":["page_root_id"],"table":"pages","references":["id"]})
@ForeignKey({"columns":["user_id"],"table":"users","references":["id"]})
@ForeignKey({"columns":["workspace_id"],"table":"workspaces","references":["id"]})
@Unique(["page_root_id"])
@Index("idx_workspace_members_active", ["workspace_id","user_id"], {"unique":true,"where":"deleted_at IS NULL"})
@Index("idx_workspace_members_user", ["user_id"])
export class WorkspaceMemberSchema extends BaseSchema {
  @Column()
  workspace_id!: string;

  @Column()
  user_id!: string;

  @Column() @Default(null)
  workspace_member_role_id!: string | null;

  @Column()
  page_root_id!: string;

  @Column() @Default(null)
  deleted_at!: string | null;
}
