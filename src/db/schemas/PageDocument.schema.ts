import { Column, Default, ForeignKey, Json, Table, Unique } from '@cubs/rqlite-client/schema';
import { BaseSchema } from './Base.schema.js';

@Table('page_documents')
@ForeignKey({ columns: ['page_id'], table: 'pages', references: ['id'] })
@Unique(['page_id'])
export class PageDocumentSchema extends BaseSchema {
  @Column()
  page_id!: string;

  @Column() @Json()
  content!: Record<string, unknown>;

  @Column() @Default(1)
  revision!: number;
}
