import {Table,Column,Default,Json,ForeignKey,Index} from '@cubs/rqlite-client/schema';
import {BaseSchema} from './Base.schema.js';

@Table('pages', {softDelete: 'deleted_at'})
@ForeignKey({"columns":["owner_id"],"table":"users","references":["id"]})
@Index("idx_pages_deleted_at", ["deleted_at"])
@Index("idx_pages_owner_id", ["owner_id"])
export class PageSchema extends BaseSchema {
  @Column() @Default(null)
  title!: string | null;

  @Column() @Json() @Default(null)
  data!: Record<string, unknown> | unknown[] | null;

  @Column()
  owner_id!: string;

  @Column() @Default(null)
  deleted_at!: string | null;
}
