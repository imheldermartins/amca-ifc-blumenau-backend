import {Table,Column,Default,ForeignKey,Index} from '@cubs/rqlite-client/schema';
import {BaseSchema} from './Base.schema.js';

@Table('pinned_schedule_pages')
@ForeignKey({"columns":["workspace_id"],"table":"workspaces","references":["id"]})
@ForeignKey({"columns":["page_id"],"table":"pages","references":["id"]})
@ForeignKey({"columns":["pinned_by_user_id"],"table":"users","references":["id"]})
@ForeignKey({"columns":["date_column_id"],"table":"page_columns","references":["id"]})
@ForeignKey({"columns":["color_column_id"],"table":"page_columns","references":["id"]})
@Index("idx_pinned_schedule_pages_workspace_user", ["workspace_id","pinned_by_user_id"])
@Index("idx_pinned_schedule_pages_unique", ["workspace_id","pinned_by_user_id","page_id"], {"unique":true})
export class PinnedSchedulePageSchema extends BaseSchema {
  @Column()
  workspace_id!: string;

  @Column()
  page_id!: string;

  @Column()
  pinned_by_user_id!: string;

  @Column()
  date_column_id!: string;

  @Column() @Default(null)
  color_column_id!: string | null;
}
