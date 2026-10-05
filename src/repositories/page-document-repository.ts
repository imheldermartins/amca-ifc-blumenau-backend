import { ulid } from 'ulid';

import db from '@models/index';

interface RawPageDocument {
  id: string;
  page_id: string;
  content: string | Record<string, unknown>;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface PageDocumentRecord extends Omit<RawPageDocument, 'content'> {
  content: Record<string, unknown>;
}

function decode(row: RawPageDocument | undefined): PageDocumentRecord | null {
  if (!row) return null;
  return {
    ...row,
    content: typeof row.content === 'string'
      ? JSON.parse(row.content) as Record<string, unknown>
      : row.content,
  };
}

export class PageDocumentStore {
  public async find(pageId: string): Promise<PageDocumentRecord | null> {
    const rows = await db.sqlRaw<RawPageDocument>({
      text: 'SELECT * FROM page_documents WHERE page_id = ? LIMIT 1',
      values: [pageId],
    }, 'query');
    return decode(rows[0]);
  }

  public async save(pageId: string, content: Record<string, unknown>): Promise<PageDocumentRecord | null> {
    const rows = await db.sqlRaw<RawPageDocument>({
      text: `INSERT INTO page_documents (id, page_id, content, revision)
        SELECT ?, id, json(?), 1 FROM pages WHERE id = ? AND deleted_at IS NULL
        ON CONFLICT(page_id) DO UPDATE SET
          content = excluded.content,
          revision = page_documents.revision + 1,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *`,
      values: [ulid(), pageId, JSON.stringify(content), pageId],
    }, 'request');
    return decode(rows[0]);
  }
}

export default new PageDocumentStore();
