import {Table,Column,Default,ForeignKey,Unique} from '@cubs/rqlite-client/schema';
import {sql} from '@cubs/rqlite-client/schema';
import {IdentitySchema} from './Base.schema.js';

@Table('access_invite_acceptances')
@ForeignKey({"columns":["user_id"],"table":"users","references":["id"]})
@ForeignKey({"columns":["invite_id"],"table":"access_invites","references":["id"]})
@Unique(["invite_id","user_id"])
export class AccessInviteAcceptanceSchema extends IdentitySchema {
  @Column()
  invite_id!: string;

  @Column()
  user_id!: string;

  @Column() @Default(sql.currentTimestamp())
  accepted_at!: string;
}
