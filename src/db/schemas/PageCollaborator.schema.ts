import {Table,Column,Default,ForeignKey,Index} from '@cubs/rqlite-client/schema';
import {BaseSchema} from './Base.schema.js';

@Table('page_collaborators', {softDelete: 'deleted_at'})
@ForeignKey({"columns":["page_member_role_id","page_id"],"table":"page_roles","references":["id","page_id"]})
@ForeignKey({"columns":["user_id"],"table":"users","references":["id"]})
@ForeignKey({"columns":["page_id"],"table":"pages","references":["id"]})
@Index("idx_page_collaborators_active", ["page_id","user_id"], {"unique":true,"where":"deleted_at IS NULL"})
@Index("idx_page_collaborators_user", ["user_id"])
export class PageCollaboratorSchema extends BaseSchema {
  @Column()
  page_id!: string;

  @Column()
  user_id!: string;

  @Column() @Default(null)
  page_member_role_id!: string | null;

  @Column() @Default(null)
  deleted_at!: string | null;
}
