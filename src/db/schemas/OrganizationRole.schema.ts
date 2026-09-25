import {Table,Column,Default,Json,Integer,ForeignKey,Unique,Check,Index} from '@cubs/rqlite-client/schema';
import {BaseSchema} from './Base.schema.js';

@Table('organization_roles', {softDelete: 'deleted_at'})
@Check("json_valid(roles)")
@Check("is_default IN (0,1)")
@ForeignKey({"columns":["organization_id"],"table":"organizations","references":["id"]})
@Unique(["id","organization_id"])
@Index("idx_organization_roles_default", ["organization_id"], {"unique":true,"where":"is_default = 1 AND deleted_at IS NULL"})
@Index("idx_organization_roles_scope", ["organization_id"])
@Index("idx_organization_roles_system", ["organization_id","system_key"], {"unique":true,"where":"system_key IS NOT NULL AND deleted_at IS NULL"})
export class OrganizationRoleSchema extends BaseSchema {
  @Column()
  organization_id!: string;

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
