import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageDocumentStore } from './page-document-repository.js';
import { PageDocumentController } from '@/controllers/page-document-controller';
import { decodePageDocument, encodePageDocument } from '@/services/pages/page-document-codec';

vi.mock('@models/index', () => ({ default: {} }));

describe('page_blocks document persistence', () => {
  let sqlite: DatabaseSync;
  let store: PageDocumentStore;
  const pageId = '01M00000000000000000000001';

  beforeEach(() => {
    sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`CREATE TABLE pages(id TEXT PRIMARY KEY,deleted_at TEXT);
      CREATE TABLE page_blocks(id TEXT PRIMARY KEY,page_id TEXT UNIQUE NOT NULL,
        content TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
    sqlite.prepare('INSERT INTO pages(id) VALUES (?)').run(pageId);
    store = new PageDocumentStore(async <T>(statement: string | SqlStatement) => {
      const text = typeof statement === 'string' ? statement : statement.text;
      const values = typeof statement === 'string' ? [] : statement.values;
      return sqlite.prepare(text).all(...values as SQLInputValue[]) as T[];
    });
  });
  afterEach(() => sqlite.close());

  it('binds only id, content and page id, then reads the saved editor JSON', async () => {
    const content = { type: 'doc', content: [{ type: 'paragraph', text: "Ação d'água" }] };
    expect(await store.find(pageId)).toBeNull();
    const saved = await store.save(pageId, content);
    expect(saved).toMatchObject({ page_id: pageId, content: encodePageDocument(content), revision: 1 });
    expect(decodePageDocument(saved!.content)).toEqual(content);
    const raw = sqlite.prepare('SELECT content FROM page_blocks WHERE page_id=?').get(pageId)!;
    expect(raw.content).toBe(JSON.stringify(encodePageDocument(content)));
    expect(await store.find(pageId)).toEqual(saved);
  });

  it('updates the one document for a page and increments only its save counter', async () => {
    const first = await store.save(pageId, { type: 'doc', content: [] });
    const content = { type: 'doc', content: [{ type: 'paragraph' }] };
    expect(await store.save(pageId, content)).toMatchObject({ id: first?.id, content: encodePageDocument(content), revision: 2 });
    expect(sqlite.prepare('SELECT COUNT(*) AS total FROM page_blocks').get()).toMatchObject({ total: 1 });
  });

  it('does not create or overwrite a document for an absent or deleted page', async () => {
    const original = await store.save(pageId, { type: 'doc', content: [] });
    sqlite.prepare('UPDATE pages SET deleted_at=CURRENT_TIMESTAMP WHERE id=?').run(pageId);
    expect(await store.save(pageId, { type: 'doc', content: [{ type: 'paragraph' }] })).toBeNull();
    expect(await store.find(pageId)).toEqual(original);
    expect(await store.save('missing', { type: 'doc', content: [] })).toBeNull();
  });
  it('reads legacy documents and upgrades only when they are saved', async () => {
    const legacy = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Existente' }] }] };
    sqlite.prepare('INSERT INTO page_blocks(id,page_id,content) VALUES (?,?,?)').run('legacy', pageId, JSON.stringify(legacy));
    expect((await store.find(pageId))?.content).toEqual(legacy);
    await store.save(pageId, legacy);
    expect((await store.find(pageId))?.content).toEqual(encodePageDocument(legacy));
  });
  it('accepts compact and old HTTP payloads and rejects corrupt versions without writing', async () => {
    const controller = new PageDocumentController(store);
    const legacy = { type: 'doc', content: [{ type: 'paragraph' }] };
    const compact = encodePageDocument(legacy);
    expect(await controller.save(pageId, { content: legacy })).toMatchObject({ ok: true, data: { content: compact, revision: 1 } });
    expect(await controller.save(pageId, { content: compact })).toMatchObject({ ok: true, data: { content: compact, revision: 2 } });
    expect(await controller.save(pageId, { content: { v: 2, b: [] } })).toMatchObject({ ok: false, reason: 'validation' });
    expect(await controller.save(pageId, { content: { v: 1, b: [[999]] } })).toMatchObject({ ok: false, reason: 'validation' });
    expect((await store.find(pageId))?.revision).toBe(2);
  });
});
