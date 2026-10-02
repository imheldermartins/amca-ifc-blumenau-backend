import assert from 'node:assert/strict';
import { RqliteClient } from '@cubs/rqlite-client';

import { migration as initial } from '../../src/db/migrations/20260924235507356_619638ca_initial_schema_from_decorators.js';
import { migration as timestamps } from '../../src/db/migrations/20260926211058243_9a36cd7b_repair_literal_updated_at.js';
import { migration as schedule } from '../../src/db/migrations/20260928231611832_eef4196a_add_pinned_schedule_pages.js';
import { migration as notifications } from '../../src/db/migrations/20260930002722501_55bb4d04_add_schedule_notifications.js';
import { migration as flow } from '../../src/db/migrations/20260930031603388_4569bf7a_add_flow_columns_and_single_page_parent.js';
import { migration as externalRecipients } from '../../src/db/migrations/20261001052915696_6534e769_allow_external_notification_recipients.js';

const url = process.argv[2];
if (url !== 'http://127.0.0.1:18014') throw new Error('Use somente o rqlite descartável com foreign keys na porta 18014');
const client = new RqliteClient({ url });
await client.waitUntilReady();

for (const migration of [initial, timestamps, schedule, notifications, flow, externalRecipients]) {
  await client.batch(migration.up, { endpoint: 'request', transaction: true });
}

const columns = await client.query<{ sql: string }>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'page_columns'");
const edges = await client.query<{ sql: string }>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'page_edges'");
const notificationColumns = await client.query<{ name: string; notnull: number }>('PRAGMA table_info(notifications)');
assert.match(columns[0]?.sql ?? '', /'flow'/);
assert.match(edges[0]?.sql ?? '', /UNIQUE \("child_id"\)/);
assert.equal(notificationColumns.find(({ name }) => name === 'recipient_user_id')?.notnull, 0);
assert.deepEqual(await client.query('PRAGMA foreign_key_check'), []);
console.log('Catálogo Flow/parent único e destinatários externos validados no rqlite descartável.');
