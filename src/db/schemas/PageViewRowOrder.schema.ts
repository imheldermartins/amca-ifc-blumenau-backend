import {Table,Column,ForeignKey,Index} from '@cubs/rqlite-client/schema';
import {BaseSchema} from './Base.schema.js';

@Table('page_view_row_order')
@ForeignKey({columns: ['parent_id'], table: 'pages', references: ['id'], onDelete: 'CASCADE'})
@ForeignKey({columns: ['row_id'], table: 'pages', references: ['id'], onDelete: 'CASCADE'})
@Index('idx_page_view_row_order_row', ['parent_id', 'view_id', 'row_id'], {unique: true})
@Index('idx_page_view_row_order_cursor', ['parent_id', 'view_id', 'rank', 'row_id'])
export class PageViewRowOrderSchema extends BaseSchema {
  @Column()
  parent_id!: string;

  @Column()
  view_id!: string;

  @Column()
  row_id!: string;

  @Column()
  rank!: string;
}
