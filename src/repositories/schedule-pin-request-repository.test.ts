import { beforeEach, describe, expect, it, vi } from 'vitest';

const doubles = vi.hoisted(() => ({
  rqlite: vi.fn(),
  sqlRaw: vi.fn(),
}));

vi.mock('@/db/client-db', () => ({ rqlite: doubles.rqlite }));
vi.mock('@models/index', () => ({ default: { sqlRaw: doubles.sqlRaw } }));

import { SchedulePinRequestStore } from './schedule-pin-request-repository.js';
import type { SchedulePinRequestRow } from './types/schedule-repository.types.js';

const WORKSPACE_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV' as NonEmptyString;
const PAGE_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAW' as NonEmptyString;
const REQUESTER_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAX' as NonEmptyString;
const RECIPIENT_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAY' as NonEmptyString;
const DATE_COLUMN_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAZ' as NonEmptyString;
const REQUEST_ID = '01ARZ3NDEKTSV4RRFFQ69G5FB0' as NonEmptyString;

function requestRow(): SchedulePinRequestRow {
  return {
    id: REQUEST_ID,
    created_at: '2026-09-30 10:00:00',
    updated_at: '2026-09-30 10:00:00',
    workspace_id: WORKSPACE_ID,
    page_id: PAGE_ID,
    requested_by_user_id: REQUESTER_ID,
    recipient_user_id: RECIPIENT_ID,
    date_column_id: DATE_COLUMN_ID,
    color_column_id: null,
    status: 'pending',
    decided_at: null,
    page_title: 'Reunião',
    requester_name: 'Solicitante',
    requester_email: 'requester@example.test',
    recipient_name: 'Destinatário',
    recipient_email: 'recipient@example.test',
  };
}

describe('SchedulePinRequestStore', () => {
  const store = new SchedulePinRequestStore();

  beforeEach(() => {
    vi.clearAllMocks();
    doubles.rqlite.mockResolvedValue([true, true, true, true]);
  });

  it('revalida a existência atual do valor de data ao criar a solicitação', async () => {
    const created = await store.create({
      requestId: REQUEST_ID,
      notificationId: '01ARZ3NDEKTSV4RRFFQ69G5FB1' as NonEmptyString,
      deliveryId: '01ARZ3NDEKTSV4RRFFQ69G5FB2' as NonEmptyString,
      workspaceId: WORKSPACE_ID,
      pageId: PAGE_ID,
      requestedByUserId: REQUESTER_ID,
      recipientUserId: RECIPIENT_ID,
      dateColumnId: DATE_COLUMN_ID,
      colorColumnId: null,
      notificationData: { status: 'pending' },
      email: {
        to: { name: 'Destinatário', email: 'recipient@example.test' },
        subject: 'Fixar',
        html: '<p>Fixar</p>',
        text: 'Fixar',
      },
    });

    expect(created).toBe(true);
    const [statements, endpoint, options] = doubles.rqlite.mock.calls[0]!;
    expect(endpoint).toBe('execute');
    expect(options).toEqual({ transaction: true });
    expect(statements[0][0]).toContain('JOIN page_columns_values date_value');
    expect(statements[1][0]).toContain("'schedule_pin_request'");
    expect(statements[2][0]).toContain("'email', 'pending'");
  });

  it('permite ao destinatário recusar mesmo se a página deixou de ser acessível', async () => {
    const decided = await store.decide(requestRow(), RECIPIENT_ID, 'declined');

    expect(decided).toBe(true);
    const [statements, endpoint, options] = doubles.rqlite.mock.calls[0]!;
    expect(endpoint).toBe('execute');
    expect(options).toEqual({ transaction: true });
    expect(statements).toHaveLength(3);
    expect(statements[0][0]).not.toContain('page_columns');
    expect(statements[0][0]).not.toContain('page_collaborators');
    expect(statements[0]).toEqual(expect.arrayContaining([
      'declined',
      REQUEST_ID,
      WORKSPACE_ID,
      RECIPIENT_ID,
    ]));
    expect(statements[2][0]).toContain("json_set(data, '$.status', ?)");
  });

  it('revalida acesso, estrutura e valor de data antes de aceitar e fixar', async () => {
    const decided = await store.decide(requestRow(), RECIPIENT_ID, 'accepted');

    expect(decided).toBe(true);
    const [statements] = doubles.rqlite.mock.calls[0]!;
    expect(statements).toHaveLength(4);
    expect(statements[0][0]).toContain('page_collaborators');
    expect(statements[0][0]).toContain('workspace_members');
    expect(statements[0][0]).toContain('JOIN page_columns_values date_value');
    expect(statements[2][0]).toContain('INSERT INTO pinned_schedule_pages');
    expect(statements[2][0]).toContain('ON CONFLICT(workspace_id, pinned_by_user_id, page_id)');
  });
});
