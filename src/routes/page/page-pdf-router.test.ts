import express from 'express';
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PagePdfService } from '@/services/pages/page-pdf-service';
const permission = vi.hoisted(() => ({ allowed: true }));
vi.mock('@/services/auth/middleware', () => ({ default: { handle: (request: { userId?: string }, _response: unknown, next: () => void) => { request.userId = 'actor'; next(); } } }));
vi.mock('@/services/auth/scoped-access-middleware', () => ({ requireScopedPermission: () => (_request: unknown, response: { status: (status: number) => { json: (body: unknown) => unknown } }, next: () => void) => permission.allowed ? next() : response.status(403).json({ message: 'Acesso não permitido' }) }));
import { PagePdfRouter } from './page-pdf-router.js';
let server: Server, origin: string;
const service = { generate: vi.fn(), batch: vi.fn(), catalog: vi.fn() };
beforeAll(async () => {
  const app = express(); app.use(express.json()); app.use('/pages', new PagePdfRouter(service as unknown as PagePdfService).build());
  server = createServer(app); await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('HTTP address');
  origin = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { await new Promise<void>((done) => server.close(() => done())); });
beforeEach(() => { vi.clearAllMocks(); permission.allowed = true; });
describe('binary page export route', () => {
  it('validates and forwards the title option for individual exports', async () => {
    const buffer = Buffer.from('%PDF-example');
    service.generate.mockResolvedValueOnce({ buffer, filename: 'pagina.pdf', contentType: 'application/pdf' });
    const result = await fetch(`${origin}/pages/source/pdf`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ includePageTitle: false }) });
    expect(result.status).toBe(200); await result.arrayBuffer();
    expect(service.generate).toHaveBeenCalledWith('source', 'actor', undefined, expect.any(AbortSignal), { includePageTitle: false });
    const invalid = await fetch(`${origin}/pages/source/pdf`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ includePageTitle: 'false' }) });
    expect(invalid.status).toBe(400); expect(service.generate).toHaveBeenCalledTimes(1);
  });
  it('sends original PDF bytes, then clears its buffer after the HTTP response finishes', async () => {
    const buffer = Buffer.from('%PDF-sensitive');
    service.generate.mockResolvedValueOnce({ buffer, filename: 'pagina.pdf', contentType: 'application/pdf' });
    const response = await fetch(`${origin}/pages/source/pdf`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(response.status).toBe(200); expect(await response.text()).toBe('%PDF-sensitive');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-disposition')).toContain('pagina.pdf');
    expect(buffer.every((byte) => byte === 0)).toBe(true);
  });
  it('rejects invalid selections before generating and guards access', async () => {
    const response = await fetch(`${origin}/pages/source/pdf`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ childIds: ['foreign-invalid'] }) });
    expect(response.status).toBe(400); expect(service.batch).not.toHaveBeenCalled();
    permission.allowed = false;
    expect((await fetch(`${origin}/pages/source/pdf`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(403);
    expect(service.generate).not.toHaveBeenCalled();
  });
  it('returns ZIP with the selected IDs and releases that buffer too', async () => {
    const id = '01K89WJ7X00000000000000012';
    const buffer = Buffer.from('PK-zip');
    service.batch.mockResolvedValueOnce({ buffer, filename: 'cubspages.zip', contentType: 'application/zip' });
    const response = await fetch(`${origin}/pages/source/pdf`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ childIds: [id] }) });
    expect(await response.text()).toBe('PK-zip');
    expect(service.batch).toHaveBeenCalledWith('source', 'actor', [id], expect.any(AbortSignal), { includePageTitle: true });
    expect(buffer.every((byte) => byte === 0)).toBe(true);
  });
});
