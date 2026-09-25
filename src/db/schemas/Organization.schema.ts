import {Table,Column,Default,Json,ForeignKey} from '@cubs/rqlite-client/schema';
import {BaseSchema} from './Base.schema.js';

@Table('organizations')
@ForeignKey({"columns":["owner_id"],"table":"users","references":["id"]})
export class OrganizationSchema extends BaseSchema {
  @Column()
  name!: string;

  @Column() @Json() @Default("{}")
  data!: Record<string, unknown> | unknown[];

  @Column() @Default(null)
  owner_id!: string | null;
}
