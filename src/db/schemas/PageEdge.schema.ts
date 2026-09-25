import {Table,Column,ForeignKey,Unique,Index} from '@cubs/rqlite-client/schema';
import {BaseSchema} from './Base.schema.js';

@Table('page_edges')
@ForeignKey({"columns":["child_id"],"table":"pages","references":["id"]})
@ForeignKey({"columns":["parent_id"],"table":"pages","references":["id"]})
@Unique(["parent_id","child_id"])
@Index("idx_page_edges_parent_id", ["parent_id"])
export class PageEdgeSchema extends BaseSchema {
  @Column()
  parent_id!: string;

  @Column()
  child_id!: string;
}
