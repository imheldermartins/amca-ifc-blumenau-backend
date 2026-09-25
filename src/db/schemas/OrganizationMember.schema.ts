import {Table,Column,Default,ForeignKey,Index} from '@cubs/rqlite-client/schema';
import {BaseSchema} from './Base.schema.js';

@Table('organization_members', {softDelete: 'deleted_at'})
@ForeignKey({"columns":["organization_member_role_id","organization_id"],"table":"organization_roles","references":["id","organization_id"]})
@ForeignKey({"columns":["user_id"],"table":"users","references":["id"]})
@ForeignKey({"columns":["organization_id"],"table":"organizations","references":["id"]})
@Index("idx_organization_members_active", ["organization_id","user_id"], {"unique":true,"where":"deleted_at IS NULL"})
@Index("idx_organization_members_user", ["user_id"])
export class OrganizationMemberSchema extends BaseSchema {
  @Column()
  organization_id!: string;

  @Column()
  user_id!: string;

  @Column() @Default(null)
  organization_member_role_id!: string | null;

  @Column() @Default(null)
  deleted_at!: string | null;
}
