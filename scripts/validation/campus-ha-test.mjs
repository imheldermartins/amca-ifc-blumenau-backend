// Run only inside the disposable campus fixture. Uses real application channels,
// Redis/Sentinel transport and clients; no production database or credentials.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { existsSync, writeFileSync } from 'node:fs';
import { io as connect } from 'socket.io-client';
import { SocketServer } from '../../dist/services/realtime/socket-server.js';
import { PageEditChannel } from '../../dist/services/realtime/page-edit-channel.js';
import { AuthorizedPageDelivery } from '../../dist/services/realtime/authorized-page-delivery.js';
import { PageRoomChannel } from '../../dist/services/realtime/page-room-channel.js';
import { PageInteractionChannel } from '../../dist/services/realtime/page-interaction-channel.js';
import { RealtimeChannelRegistry } from '../../dist/services/realtime/realtime-channel-registry.js';
import { SystemChannel } from '../../dist/services/realtime/system-channel.js';
import { ClusterRateStore } from '../../dist/services/http/cluster-rate-store.js';
import { clusterRedis, waitForCluster } from '../../dist/services/cluster/cluster-redis.js';

if (process.env.CUBS_DISPOSABLE_CAMPUS_TEST !== 'true') throw new Error('Disposable fixture required');
setTimeout(() => { console.error('Campus HA fixture timed out'); process.exit(1); }, 120000).unref();
const redis = clusterRedis();
const servers = [], clients = [];
const allowed = new Set(['editor', 'viewer', 'revoked']);
const pageId = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
async function until(check, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (await check()) return; } catch {}
    await delay(200);
  }
  throw new Error('Campus fixture did not reach expected state');
}
try {
  await waitForCluster();
  for (const user of ['editor', 'viewer', 'revoked']) {
    const delivery = new AuthorizedPageDelivery(undefined, { can: async (_scope, _id, userId) => allowed.has(userId) });
    const edits = new PageEditChannel(delivery.deliver.bind(delivery));
    const rooms = new PageRoomChannel({ canAccessPage: async () => true });
    const registry = new RealtimeChannelRegistry([new SystemChannel(), edits, rooms, new PageInteractionChannel(async () => true)]);
    const http = createServer();
    const io = new SocketServer(registry, { verifyAccessToken: token => ({ sub: token }) }).attach(http);
    servers.push({ http, io, edits });
    http.listen(0, '127.0.0.1'); await once(http, 'listening');
    const client = connect(`http://127.0.0.1:${http.address().port}`, { auth: { token: user }, transports: ['websocket'], forceNew: true });
    clients.push(client); await once(client, 'connect');
    const joined = once(client, 'joined-page-database');
    client.emit('join-page-database', { pageId }); await joined;
  }
  await until(async () => await servers[0].io.sockets.adapter.serverCount() === 3);
  const rates = [0, 1, 2].map(() => new ClusterRateStore(redis, 'cubs:test:rate:'));
  rates.forEach(r => r.init({ windowMs: 60000 }));
  const hits = await Promise.all(Array.from({ length: 24 }, (_, i) => rates[i % 3].increment('one-ip')));
  assert.deepEqual(hits.map(x => x.totalHits).sort((a, b) => a - b), Array.from({ length: 24 }, (_, i) => i + 1));
  allowed.delete('revoked');
  const received = once(clients[1], 'page-updated');
  const denied = once(clients[2], 'page-database-denied');
  let leaked = 0;
  clients[2].on('page-updated', () => leaked++);
  servers[0].edits.emitPageUpdated({ pageId, title: 'cross-campus', originUserId: 'editor', eventId: 'fixture-event', updatedAt: new Date().toISOString() });
  assert.equal((await received)[0].title, 'cross-campus');
  await denied;
  await delay(200); assert.equal(leaked, 0);
  assert.equal((await servers[0].io.in(`page-database:${pageId}`).fetchSockets()).length, 2);

  // The controller now stops the initial data + Sentinel pair, simulating
  // losing Blumenau. Keep the same application connections during election.
  writeFileSync('/fixture/ready', 'ready');
  await until(() => existsSync('/fixture/outage'), 30000);
  await until(async () => {
    // The existing client must reconnect to an elected master and accept writes.
    return (await redis.set('cubs:test:after-outage', 'survived')) === 'OK';
  }, 60000);
  await until(async () => (await servers[1].io.in(`page-database:${pageId}`).fetchSockets()).length === 2);
  const remote = once(clients[1], 'page-updated');
  servers[2].edits.emitPageUpdated({ pageId, title: 'after-Blumenau-outage', originUserId: 'viewer', eventId: 'fixture-event-2', updatedAt: new Date().toISOString() });
  assert.equal((await remote)[0].title, 'after-Blumenau-outage');
  assert.equal((await rates[1].increment('one-ip')).totalHits, 25);
  console.log('Campus HA passed: cross-API realtime, remote authorization, shared rate limits, Sentinel election and existing connections after origin outage.');
} finally {
  clients.forEach(c => c.disconnect());
  await Promise.all(servers.map(({ io }) => new Promise(resolve => io.close(resolve))));
  redis?.disconnect();
}
