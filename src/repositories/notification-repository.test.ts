import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const doubles = vi.hoisted(() => ({
  rqlite: vi.fn(),
  sqlRaw: vi.fn(),
}));

vi.mock('@/db/client-db', () => ({ rqlite: doubles.rqlite }));
vi.mock('@models/index', () => ({ default: { sqlRaw: doubles.sqlRaw } }));

import { NotificationStore } from './notification-repository.js';

const WORKSPACE_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV' as NonEmptyString;
const USER_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAW' as NonEmptyString;
const OTHER_USER_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAX' as NonEmptyString;
const NOTIFICATION_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAY' as NonEmptyString;
const DELIVERY_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAZ' as NonEmptyString;

let sqlite: DatabaseSync;

function runStatement(statement: SqlStatement): unknown[] | boolean {
  const prepared = sqlite.prepare(statement.text);
  if (/^\s*SELECT\b/i.test(statement.text) || /\bRETURNING\b/i.test(statement.text)) {
    return prepared.all(...statement.values as Array<string | number | null>);
  }
  return prepared.run(...statement.values as Array<string | number | null>).changes > 0;
}

describe('NotificationStore', () => {
  const store = new NotificationStore();

  beforeEach(() => {
    sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`CREATE TABLE users (
      id TEXT PRIMARY KEY,
      name TEXT,
      email TEXT NOT NULL
    );
    CREATE TABLE notifications (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      recipient_user_id TEXT NOT NULL,
      actor_user_id TEXT,
      type TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      data TEXT NOT NULL,
      dedupe_key TEXT NOT NULL UNIQUE,
      read_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE notification_deliveries (
      id TEXT PRIMARY KEY,
      notification_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      payload TEXT NOT NULL,
      next_attempt_at TEXT,
      locked_at TEXT,
      sent_at TEXT,
      provider_message_id TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(notification_id, channel)
    );`);
    sqlite.prepare('INSERT INTO users (id, name, email) VALUES (?, ?, ?), (?, ?, ?)').run(
      USER_ID,
      'Pessoa',
      'person@example.test',
      OTHER_USER_ID,
      'Outra pessoa',
      'other@example.test',
    );

    doubles.rqlite.mockReset();
    doubles.sqlRaw.mockReset();
    doubles.rqlite.mockImplementation(async (
      statements: RqliteStatement[],
      endpoint: string,
      options?: { transaction?: boolean },
    ) => {
      if (!options?.transaction) return statements.map(([text, ...values]) =>
        runStatement({ text: String(text), values }));
      sqlite.exec('BEGIN');
      try {
        const results = statements.map(([text, ...values]) =>
          runStatement({ text: String(text), values }));
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    });
    doubles.sqlRaw.mockImplementation(async (statement: SqlStatement) => runStatement(statement));
  });

  afterEach(() => sqlite.close());

  it('grava notificação e entrega atomicamente e deduplica pelo fato canônico', async () => {
    const input = {
      id: NOTIFICATION_ID,
      deliveryId: DELIVERY_ID,
      workspaceId: WORKSPACE_ID,
      recipientUserId: USER_ID,
      actorUserId: null,
      type: 'schedule_event_reminder' as const,
      resourceType: 'page' as const,
      resourceId: '01ARZ3NDEKTSV4RRFFQ69G5FB0' as NonEmptyString,
      data: { pageTitle: 'Reunião' },
      dedupeKey: 'schedule-reminder:pin:start',
      email: {
        to: { name: 'Pessoa', email: 'person@example.test' },
        subject: 'Lembrete',
        html: '<p>Lembrete</p>',
        text: 'Lembrete',
      },
    };

    await expect(store.enqueue(input)).resolves.toBe(true);
    await expect(store.enqueue({
      ...input,
      id: '01ARZ3NDEKTSV4RRFFQ69G5FB1' as NonEmptyString,
      deliveryId: '01ARZ3NDEKTSV4RRFFQ69G5FB2' as NonEmptyString,
    })).resolves.toBe(false);

    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM notifications').get()?.count).toBe(1);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM notification_deliveries').get()?.count).toBe(1);
    expect(sqlite.prepare('SELECT notification_id FROM notification_deliveries').get()?.notification_id)
      .toBe(NOTIFICATION_ID);
  });

  it('só marca como lida a notificação do usuário e workspace informados', async () => {
    await store.enqueue({
      id: NOTIFICATION_ID,
      deliveryId: DELIVERY_ID,
      workspaceId: WORKSPACE_ID,
      recipientUserId: USER_ID,
      actorUserId: null,
      type: 'schedule_event_reminder',
      resourceType: 'page',
      resourceId: '01ARZ3NDEKTSV4RRFFQ69G5FB0' as NonEmptyString,
      data: {},
      dedupeKey: 'scope-test',
      email: {
        to: { name: 'Pessoa', email: 'person@example.test' },
        subject: 'Lembrete',
        html: '<p>Lembrete</p>',
        text: 'Lembrete',
      },
    });

    await expect(store.markRead(WORKSPACE_ID, OTHER_USER_ID, NOTIFICATION_ID)).resolves.toBe(false);
    expect(sqlite.prepare('SELECT read_at FROM notifications WHERE id = ?').get(NOTIFICATION_ID)?.read_at)
      .toBeNull();
    await expect(store.markRead(WORKSPACE_ID, USER_ID, NOTIFICATION_ID)).resolves.toBe(true);
    expect(sqlite.prepare('SELECT read_at FROM notifications WHERE id = ?').get(NOTIFICATION_ID)?.read_at)
      .not.toBeNull();
  });

  it('recupera lock expirado da outbox e conclui somente a entrega reclamada', async () => {
    sqlite.prepare(`INSERT INTO notifications (
      id, workspace_id, recipient_user_id, type, resource_type, resource_id, data, dedupe_key
    ) VALUES (?, ?, ?, 'schedule_event_reminder', 'page', ?, '{}', 'stale')`).run(
      NOTIFICATION_ID,
      WORKSPACE_ID,
      USER_ID,
      '01ARZ3NDEKTSV4RRFFQ69G5FB0',
    );
    sqlite.prepare(`INSERT INTO notification_deliveries (
      id, notification_id, channel, status, attempts, payload, locked_at
    ) VALUES (?, ?, 'email', 'processing', 1, '{}', '2026-09-30T09:00:00.000Z')`).run(
      DELIVERY_ID,
      NOTIFICATION_ID,
    );

    const due = await store.listDueDeliveries(
      '2026-09-30T10:30:00.000Z',
      '2026-09-30T10:20:00.000Z',
    );
    expect(due).toHaveLength(1);
    await expect(store.claimDelivery(
      DELIVERY_ID,
      '2026-09-30T10:30:00.000Z',
      '2026-09-30T10:20:00.000Z',
    )).resolves.toBe(true);
    await store.markSent(DELIVERY_ID, 'provider-id');

    expect(sqlite.prepare(`SELECT status, attempts, provider_message_id, locked_at
      FROM notification_deliveries WHERE id = ?`).get(DELIVERY_ID)).toEqual({
      status: 'sent',
      attempts: 2,
      provider_message_id: 'provider-id',
      locked_at: null,
    });
  });
});
