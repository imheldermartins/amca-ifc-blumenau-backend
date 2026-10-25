import { Table, Column, ForeignKey, Index } from '@cubs/rqlite-client/schema';
import { BaseSchema } from './Base.schema.js';

@Table('page_favorites')
@ForeignKey({ columns: ['user_id'], table: 'users', references: ['id'], onDelete: 'CASCADE' })
@ForeignKey({ columns: ['page_id'], table: 'pages', references: ['id'], onDelete: 'CASCADE' })
@Index('idx_page_favorites_user_page', ['user_id', 'page_id'], { unique: true })
@Index('idx_page_favorites_user_created', ['user_id', 'created_at', 'id'])
export class PageFavoriteSchema extends BaseSchema {
  @Column()
  user_id!: string;

  @Column()
  page_id!: string;
}
