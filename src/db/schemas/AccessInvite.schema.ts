import {Table,Column,Default,Integer,ForeignKey,Unique,Check,Index} from '@cubs/rqlite-client/schema';
import {BaseSchema} from './Base.schema.js';

@Table('access_invites', {softDelete: 'deleted_at'})
@Check("length(token_hash) = 64")
@Check("scope_type IN ('organization','workspace','page')")
@Check("status IN ('pending','accepted','rejected','canceled','expired')")
@Check("acceptance_limit IS NULL OR acceptance_limit > 0")
@Check("acceptance_count >= 0")
@ForeignKey({"columns":["author_id"],"table":"users","references":["id"]})
@Unique(["token_hash"])
@Index("idx_access_invites_recipient", [], {"expressions":["lower(trim(recipient_email))"]})
@Index("idx_access_invites_scope", ["scope_type","scope_id","created_at"])
export class AccessInviteSchema extends BaseSchema {
  @Column()
  token_hash!: string;

  @Column()
  token_hint!: string;

  @Column()
  scope_type!: string;

  @Column()
  scope_id!: string;

  @Column() @Default(null)
  role_id!: string | null;

  @Column() @Default(null)
  recipient_email!: string | null;

  @Column()
  author_id!: string;

  @Column() @Default("pending")
  status!: string;

  @Column() @Default(null)
  expires_at!: string | null;

  @Column() @Integer() @Default(null)
  acceptance_limit!: number | null;

  @Column() @Integer() @Default(0)
  acceptance_count!: number;

  @Column() @Default(null)
  notified_at!: string | null;

  @Column() @Default(null)
  deleted_at!: string | null;
}
