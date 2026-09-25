import {Table,Column,Default,Json,ForeignKey,Unique,Check,Index} from '@cubs/rqlite-client/schema';
import {sql} from '@cubs/rqlite-client/schema';
import {BaseSchema} from './Base.schema.js';

@Table('account_verifications', {softDelete: 'deleted_at'})
@Check("length(token_hash) = 64")
@Check("json_valid(context)")
@ForeignKey({"columns":["invite_id"],"table":"access_invites","references":["id"]})
@ForeignKey({"columns":["user_id"],"table":"users","references":["id"]})
@Unique(["token_hash"])
@Index("idx_account_verifications_active", ["user_id"], {"unique":true,"where":"consumed_at IS NULL AND deleted_at IS NULL"})
export class AccountVerificationSchema extends BaseSchema {
  @Column()
  user_id!: string;

  @Column()
  token_hash!: string;

  @Column()
  token_hint!: string;

  @Column() @Default(null)
  invite_id!: string | null;

  @Column() @Json() @Default("{}")
  context!: Record<string, unknown> | unknown[];

  @Column()
  expires_at!: string;

  @Column() @Default(sql.currentTimestamp())
  last_sent_at!: string;

  @Column() @Default(null)
  consumed_at!: string | null;

  @Column() @Default(null)
  deleted_at!: string | null;
}
