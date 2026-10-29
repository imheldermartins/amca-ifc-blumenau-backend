# Full Cub's application per campus

## Coordination and sessions

The campus app overlay enables CUBS_CLUSTER_ENABLED=true. APIs require all three
private Sentinel endpoints and a matching protected 64-128 digit hex secret
mounted at /run/secrets/cluster_redis. They discover the elected `cubs-campus`
Valkey primary, rather than always connecting to Blumenau. Readiness covers the
database and coordination; startup refuses an isolated campus profile.

Each campus runs one Valkey data service and one Sentinel. Initially Blumenau is
primary; the others replicate. Three Sentinels with quorum two elect a surviving
primary. Persist both data and Sentinel config volumes. Do not regenerate their
config on restart or force the original primary after failover. Keep announced
Mesh IPs stable and reachable from every API/container. Do not use one central
Redis node and call the result campus HA. Configure the same initial primary IP
on first boot only; the saved runtime configuration owns subsequent elections.

Valkey is only coordination/cache; business data remains in rqlite. Replication
of coordination is asynchronous, so a failover can lose recent transient events
or counter increments. min-replicas-to-write=1 limits isolated-primary writes.
An outage can briefly interrupt requests during election; this is not zero
recovery time or exactly-once realtime. Do not expose coordination publicly.

Socket.IO uses the official Redis Streams adapter. Page edit delivery is relayed
to the other APIs, and each API rechecks local socket permissions before sending
payloads. Presence counts use fetchSockets across APIs; interaction broadcasts
use the adapter. Global/auth/form rate counters share isolated prefixes. Store
failure fails HTTP requests rather than silently allowing an unlimited bypass.
A campus URL routes to one API, so its polling session stays on that campus;
adding cross-server HTTP load balancing later requires sticky sessions or
WebSocket-only clients. Reconnection/reload remains necessary after losing a
campus URL; there is no public URL failover configured by this skill.

Use identical JWT_ACCESS_SECRET/JWT_REFRESH_SECRET and other cryptographic app
keys, matching database app credentials and compatible SMTP configuration on
all sites, transferred securely outside Git. Cookie policy remains host-only
(__Host-); opening a different campus may require signing in again. Do not
broaden cookie domains to simulate single sign-on. APP_PUBLIC_URL uses the local
campus for new email links; previously issued links remain on their issuing host.

Notification workers may run on every campus: schedule dedupe keys, unique
notification/channel identity and atomic outbox claims live in the shared DB.
Delivery is at-least-once: a crash after SMTP accepts and before markSent can
repeat mail. Never promise exactly-once SMTP. Verify concurrent claims in a
fixture and a safe notification after failover before declaring live readiness.

## Compose on each physical host

Fill protected /etc/cubs/cluster/<campus>.env from its example. backend.env is a
complete production backend configuration, with shared credentials provisioned
privately. cloudflare.env contains only this campus's tunnel token. Never copy
the first host's machine binding or Raft data directory to another host.

Blumenau retains its original project (`docker` in the audit) and volume. Merge:

1. docker/docker-compose.prod.yml
2. docker/docker-compose.cluster-origin.yml
3. docker/docker-compose.campus-coordination.yml
4. docker/docker-compose.campus-app.yml

Use the existing rqlite.prod.env plus the protected Blumenau env. Keep original
NODE_ID=1, network/IP and exact volume. Inspect env_file merge ordering before
recreation without printing secrets: the protected campus file must take
precedence over legacy defaults. Its own tunnel env must override the old token
only if a different tunnel was explicitly selected.

Videira and Rio do Sul each use their own project (`cubs-ifc-videira`,
`cubs-ifc-riodosul`) and protected env, merging:

1. docker/docker-compose.cluster-peer.yml
2. docker/docker-compose.campus-coordination.yml
3. docker/docker-compose.campus-app.yml

Do not merge prod and peer YAML. Bring up DB candidates first and validate JOIN,
then coordination on all three hosts. Wait for one primary/two replicas,
three Sentinels and writable coordination before starting APIs. The initial
single Valkey primary intentionally cannot write without one replica.

Save the actual active Compose project/files/env paths under /etc/cubs/cluster
on each host. A later named-campus deploy must reuse those inputs. Validate
with config --quiet, tag rollback images, build selected applications, check
new-image migration status, then up -d --no-deps selected services only. Never
run the original single-host deploy helper over an active cluster: it regenerates
a smaller auth file and omits the cluster overlays.

## Temporary Blumenau hostname cutover

While the remote machines are not enrolled, prod + campus-transition YAML can
serve the new public name with the existing single database/API. The transition
changes the same containers; it creates no new host and provides no HA.
Its CUBS_CLUSTER_ENABLED=false is temporary and explicit. Retire the old routes
only after new-host HTTPS, API readiness and Socket.IO pass. Once real private
nodes/coordination are ready, replace transition with the full origin +
coordination + app overlays; retain volume/project and verify all three APIs.

## Validation

Run Python cluster tests including --integration for disposable rqlite JOIN.
Build the backend, then run scripts/validation/campus-ha-fixture.py on Linux.
It creates isolated containers/network/data, tests real Socket.IO channels,
shared quotas and remote authorization, stops the initial data+Sentinel pair,
and verifies election plus surviving application connections. No live volumes,
credentials, public ports or Cloudflare configuration are used in that fixture.

These tests do not replace all-pairs Mesh checks, real database replication,
public TLS/API/socket checks, notification tests or a scheduled physical-campus
outage rehearsal. Keep at least two voting DB nodes and Sentinels available.

## Sources

- [Socket.IO Streams adapter](https://socket.io/docs/v4/redis-streams-adapter/)
- [Sentinel availability and replication limits](https://redis.io/docs/latest/management/sentinel/)
- [ioredis Sentinel discovery](https://github.com/redis/ioredis#sentinel)
