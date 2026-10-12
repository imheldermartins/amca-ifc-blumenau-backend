import {Table,Column,ForeignKey,Index} from '@cubs/rqlite-client/schema';
import {BaseSchema} from './Base.schema.js';

@Table('page_view_row_order')
@ForeignKey({columns: ['edge_id'], table: 'page_edges', references: ['id'], onDelete: 'CASCADE'})
@Index('idx_page_view_row_order_edge_view', ['edge_id', 'view_id'], {unique: true})
@Index('idx_page_view_row_order_cursor', ['view_id', 'rank', 'edge_id'])
export class PageViewRowOrderSchema extends BaseSchema {
  @Column()
  edge_id!: string;

  @Column()
  view_id!: string;

  @Column()
  rank!: string;
}
