import {Table,Column,Default,Json,ForeignKey,Check,Index} from '@cubs/rqlite-client/schema';
import {BaseSchema} from './Base.schema.js';

@Table('page_columns', {softDelete: 'deleted_at'})
@Check("type IN ('text', 'numeric', 'select', 'date', 'checkbox', 'flow')")
@ForeignKey({"columns":["parent_id"],"table":"pages","references":["id"]})
@Index("idx_page_columns_parent_deleted_at", ["parent_id","deleted_at"])
export class PageColumnSchema extends BaseSchema {
  @Column() @Default(null)
  name!: string | null;

  @Column() @Default(null)
  type!: string | null;

  @Column() @Json() @Default(null)
  data!: Record<string, unknown> | unknown[] | null;

  @Column() @Default(null)
  parent_id!: string | null;

  @Column() @Default(null)
  deleted_at!: string | null;
}
