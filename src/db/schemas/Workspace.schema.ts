import {Table,Column,Default,Json,ForeignKey,Index} from '@cubs/rqlite-client/schema';
import {BaseSchema} from './Base.schema.js';

@Table('workspaces')
@ForeignKey({"columns":["created_by_user_id"],"table":"users","references":["id"]})
@ForeignKey({"columns":["organization_id"],"table":"organizations","references":["id"]})
@Index("idx_workspaces_organization_id", ["organization_id"])
export class WorkspaceSchema extends BaseSchema {
  @Column() @Default(null)
  name!: string | null;

  @Column() @Json() @Default(null)
  data!: Record<string, unknown> | unknown[] | null;

  @Column() @Default(null)
  organization_id!: string | null;

  @Column() @Default("lucide:boxes")
  icon!: string;

  @Column() @Default(null)
  created_by_user_id!: string | null;
}
