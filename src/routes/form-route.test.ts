import { createServer, type Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PageFormController } from '@/controllers/page-form-controller';
import { FormRouter } from '@/routes/form-route';
import type { PageRealtimePublisher } from '@/services/realtime/page-realtime-publisher';

const PUBLICATION = '01KXVZ00000000000000000001';
const PAGE = '01KXVZ00000000000000000002';
const ROW = '01KXVZ00000000000000000003';

const forms = {
  definition: vi.fn(),
  submitPublic: vi.fn(),
  review: vi.fn(),
};
const realtime = { rowCreated: vi.fn(async () => undefined) };
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/forms', new FormRouter(
    forms as unknown as PageFormController,
    realtime as unknown as PageRealtimePublisher,
  ).build());
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Porta efêmera indisponível');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

beforeEach(() => vi.clearAllMocks());

describe('FormRouter', () => {
  it('publica row-created depois de uma submissão pública nova', async () => {
    const result = {
      submissionId: '01KXVZ00000000000000000004',
      submittedAt: '2026-10-02T20:00:00.000Z',
      callback: 'ok',
    };
    const event = { pageId: PAGE, rowId: ROW, originUserId: `public-form:${PUBLICATION}` };
    forms.submitPublic.mockResolvedValue({ ok: true, data: { result, realtime: event } });

    const response = await fetch(`${baseUrl}/forms/publications/${PUBLICATION}/submissions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'request-1',
        'X-Cubs-Form-Capability': 'cubs_form_fill_v1_secret',
      },
      body: JSON.stringify({ fields: [] }),
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual(result);
    expect(forms.submitPublic).toHaveBeenCalledWith(
      PUBLICATION,
      'cubs_form_fill_v1_secret',
      'request-1',
      { fields: [] },
    );
    expect(realtime.rowCreated).toHaveBeenCalledWith(event);
  });

  it('não republica realtime no replay idempotente', async () => {
    forms.submitPublic.mockResolvedValue({
      ok: true,
      data: {
        result: {
          submissionId: '01KXVZ00000000000000000004',
          submittedAt: '2026-10-02T20:00:00.000Z',
          callback: null,
        },
        realtime: null,
      },
    });

    const response = await fetch(`${baseUrl}/forms/publications/${PUBLICATION}/submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'request-1' },
      body: JSON.stringify({ fields: [] }),
    });

    expect(response.status).toBe(201);
    expect(realtime.rowCreated).not.toHaveBeenCalled();
  });
});
