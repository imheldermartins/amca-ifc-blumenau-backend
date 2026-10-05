import express from 'express';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageViewQueryController } from '@/controllers/page-view-query-controller';
import type { PageViewQueryStore } from '@/repositories/page-view-query-repository';
import { PageViewQueryRouter } from './page-view-query-router.js';

const ROOT = '01M00000000000000000000001', VIEW = '01M00000000000000000000002', USER = '01M00000000000000000000003';
vi.mock('@/services/auth/middleware', () => ({ default: { handle: (request: express.Request, response: express.Response, next: express.NextFunction) => {
  if (request.headers.authorization === 'deny') { response.status(401).json({ message: 'Não autorizado' }); return; }
  request.userId = '01M00000000000000000000003'; next();
} } }));
vi.mock('@/services/auth/page-access-middleware', () => ({ requirePageAccess: () => (request: express.Request, response: express.Response, next: express.NextFunction) => {
  if (request.params.id !== '01M00000000000000000000001') { response.status(404).json({ message: '"Page" não encontrado' }); return; } next();
} }));

describe('paginated view HTTP routes', () => {
  let server: Server, base: string;
  const metadata = vi.fn(async () => ({ page: { id: ROOT, data: { [VIEW]: { view: 'table' } } }, columns: [] }));
  const query = vi.fn(async () => ({ version: 1, kind: 'table', pageId: ROOT, viewId: VIEW, orderRevision: 0, datasetRevision: 0, total: 0, queryKey: 'test', windows: [] }));
  beforeAll(async () => {
    const application = express(); application.use(express.json());
    application.use('/api/v1/pages', new PageViewQueryRouter(new PageViewQueryController({ metadata, query } as unknown as PageViewQueryStore)).build());
    server = application.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing test listener');
    base = `http://127.0.0.1:${address.port}/api/v1/pages`;
  });
  afterAll(async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); });
  beforeEach(() => vi.clearAllMocks());
  it('returns metadata without invoking a row query', async () => {
    const response = await fetch(`${base}/${ROOT}/view-metadata`);
    expect(response.status).toBe(200); expect((await response.json()).columns).toEqual([]);
    expect(metadata).toHaveBeenCalledWith(ROOT, USER); expect(query).not.toHaveBeenCalled();
  });
  it('uses the authenticated actor and temporary request filters', async () => {
    const filters = { version: 2, clauses: [{ columnId: 'page_title', condition: 'contains', values: ['ação'] }], groupBy: [] };
    const response = await fetch(`${base}/${ROOT}/views/${VIEW}/query`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ filters, limit: 50 }) });
    expect(response.status).toBe(200); expect(query).toHaveBeenCalledWith(ROOT, VIEW, USER, { filters, limit: 50 });
  });
  it('rejects oversized requests before reaching the repository', async () => {
    const response = await fetch(`${base}/${ROOT}/views/${VIEW}/query`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ limit: 51 }) });
    expect(response.status).toBe(400); expect(await response.json()).toHaveProperty('message'); expect(query).not.toHaveBeenCalled();
  });
  it('does not expose metadata or enter the query for an unauthorized actor/page', async () => {
    expect((await fetch(`${base}/${ROOT}/view-metadata`, { headers: { authorization: 'deny' } })).status).toBe(401);
    expect((await fetch(`${base}/${USER}/view-metadata`)).status).toBe(404);
    expect(metadata).not.toHaveBeenCalled(); expect(query).not.toHaveBeenCalled();
  });
});
