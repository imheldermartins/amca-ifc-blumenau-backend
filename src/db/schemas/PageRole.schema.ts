import {Table,Column,Default,Json,Integer,ForeignKey,Unique,Check,Index} from '@cubs/rqlite-client/schema';
import {BaseSchema} from './Base.schema.js';

@Table('page_roles', {softDelete: 'deleted_at'})
@Check("json_valid(roles)")
@Check("is_default IN (0,1)")
@ForeignKey({"columns":["page_id"],"table":"pages","references":["id"]})
@Unique(["id","page_id"])
@Index("idx_page_roles_default", ["page_id"], {"unique":true,"where":"is_default = 1 AND deleted_at IS NULL"})
@Index("idx_page_roles_scope", ["page_id"])
@Index("idx_page_roles_system", ["page_id","system_key"], {"unique":true,"where":"system_key IS NOT NULL AND deleted_at IS NULL"})
export class PageRoleSchema extends BaseSchema {
  @Column()
  page_id!: string;

  @Column()
  name!: string;

  @Column() @Json()
  roles!: Record<string, unknown> | unknown[];

  @Column() @Integer() @Default(0)
  is_default!: number;

  @Column() @Default(null)
  system_key!: string | null;

  @Column() @Default(null)
  deleted_at!: string | null;
}
