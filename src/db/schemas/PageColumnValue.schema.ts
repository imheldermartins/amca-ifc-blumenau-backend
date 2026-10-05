import {Table,Column,Default,ForeignKey,Index,Integer} from '@cubs/rqlite-client/schema';
import {BaseSchema} from './Base.schema.js';

@Table('page_columns_values')
@ForeignKey({"columns":["page_id"],"table":"pages","references":["id"]})
@ForeignKey({"columns":["page_column_id"],"table":"page_columns","references":["id"]})
@Index("idx_page_columns_values_cell", ["page_id","page_column_id"], {"unique":true})
@Index('idx_page_values_select', ['page_column_id', 'select_option_id', 'page_id'], {where: 'select_option_id IS NOT NULL'})
@Index('idx_page_values_number', ['page_column_id', 'number_value', 'page_id'], {where: 'number_value IS NOT NULL'})
@Index('idx_page_values_date_start', ['page_column_id', 'date_start_ms', 'page_id'], {where: 'date_start_ms IS NOT NULL'})
@Index('idx_page_values_date_end', ['page_column_id', 'date_end_ms', 'page_id'], {where: 'date_end_ms IS NOT NULL'})
@Index('idx_page_values_search', ['page_column_id', 'search_text', 'page_id'], {where: 'search_text IS NOT NULL'})
@Index('idx_page_values_checkbox', ['page_column_id', 'checkbox_value', 'page_id'], {where: 'checkbox_value IS NOT NULL'})
export class PageColumnValueSchema extends BaseSchema {
  @Column() @Default(null)
  data!: string | null;

  @Column() @Default(null)
  search_text!: string | null;

  @Column({type: 'REAL'}) @Default(null)
  number_value!: number | null;

  @Column() @Default(null)
  select_option_id!: string | null;

  @Column() @Integer() @Default(null)
  checkbox_value!: number | null;

  @Column() @Integer() @Default(null)
  date_start_ms!: number | null;

  @Column() @Integer() @Default(null)
  date_end_ms!: number | null;

  @Column() @Default('missing')
  value_kind!: string;

  @Column() @Integer() @Default(0)
  projection_version!: number;

  @Column() @Default(null)
  page_column_id!: string | null;

  @Column() @Default(null)
  page_id!: string | null;
}
