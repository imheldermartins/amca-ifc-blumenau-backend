import {Table,Column,Default,ForeignKey,Index} from '@cubs/rqlite-client/schema';
import {BaseSchema} from './Base.schema.js';

@Table('page_columns_values')
@ForeignKey({"columns":["page_id"],"table":"pages","references":["id"]})
@ForeignKey({"columns":["page_column_id"],"table":"page_columns","references":["id"]})
@Index("idx_page_columns_values_cell", ["page_id","page_column_id"], {"unique":true})
export class PageColumnValueSchema extends BaseSchema {
  @Column() @Default(null)
  data!: string | null;

  @Column() @Default(null)
  page_column_id!: string | null;

  @Column() @Default(null)
  page_id!: string | null;
}
