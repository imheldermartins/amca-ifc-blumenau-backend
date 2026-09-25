import {Table,Column,Default,Integer,Unique,Index} from '@cubs/rqlite-client/schema';
import {BaseSchema} from './Base.schema.js';

@Table('users')
@Unique(["email"])
@Index("idx_users_email", ["email"])
export class UserSchema extends BaseSchema {
  @Column() @Default(null)
  name!: string | null;

  @Column()
  email!: string;

  @Column() @Default(null)
  password_hash!: string | null;

  @Column() @Integer() @Default(0)
  token_version!: number;

  @Column() @Default(null)
  email_verified_at!: string | null;
}
