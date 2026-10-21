import {Table, Column, PrimaryKey, ForeignKey, Index, Integer} from '@cubs/rqlite-client/schema';

/** Índice relacional dos snapshots de células, mantido na mesma transação. */
@Table('page_relation_links')
@PrimaryKey(['source_cell_id', 'target_page_id'])
@ForeignKey({columns: ['source_cell_id'], table: 'page_columns_values', references: ['id'], onDelete: 'CASCADE'})
@ForeignKey({columns: ['target_page_id'], table: 'pages', references: ['id'], onDelete: 'CASCADE'})
@Index('idx_page_relation_links_target', ['target_page_id', 'source_cell_id'])
export class PageRelationLinkSchema {
  @Column()
  source_cell_id!: string;

  @Column()
  target_page_id!: string;

  @Column() @Integer()
  position!: number;
}
