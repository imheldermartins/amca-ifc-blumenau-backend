import {Table,Column,Default,Json,ForeignKey,Index,Integer} from '@cubs/rqlite-client/schema';
import {BaseSchema} from './Base.schema.js';

@Table('pages', {softDelete: 'deleted_at'})
@ForeignKey({"columns":["owner_id"],"table":"users","references":["id"]})
@Index("idx_pages_deleted_at", ["deleted_at"])
@Index("idx_pages_owner_id", ["owner_id"])
@Index('idx_pages_title_search', ['title_search', 'id'], {where: 'deleted_at IS NULL'})
export class PageSchema extends BaseSchema {
  @Column() @Default(null)
  title!: string | null;

  @Column() @Default(null)
  title_search!: string | null;

  @Column() @Integer() @Default(0)
  projection_version!: number;

  @Column() @Integer() @Default(0)
  dataset_revision!: number;

  @Column() @Json() @Default(null)
  data!: Record<string, unknown> | unknown[] | null;

  @Column()
  owner_id!: string;

  @Column() @Default(null)
  deleted_at!: string | null;
}
