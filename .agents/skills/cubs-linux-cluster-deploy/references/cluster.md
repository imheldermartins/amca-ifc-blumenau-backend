# Extend the existing cluster on native Linux

## Existing support and protocol

The repository pins rqlite `10.3.3` in `docker/rqlite/Dockerfile`. Its `-join`
expects private Raft `host:4002` addresses, not the HTTP API on 4001 or a public
HTTPS URL. Confirm the actual binary's `-version` and `-h` on each host first.

The existing production Compose already passes `NODE_ID`, `JOIN_NODE` and
advertised IP settings. Its launcher does not pass `-join-as`, and
`scripts/deploy/config.mjs` generates application/reader users without JOIN or
membership-management permissions. Setting `JOIN_NODE` alone is not a complete deployment.

## Auth files

Prepare a protected superset of the existing auth entries, preserving app and
health users/passwords. Add `cubs_cluster_join` with `join` and `join-read-only`
permissions and matching credentials on the participating nodes. The new
launcher passes `-join-as cubs_cluster_join`; rqlite reads its password from the
auth file instead of the command line. Use a separate protected operator account
for `backup`, `status`, `ready` and, only for the planned candidate conversion,
`remove`, as required. Do not grant cluster
administration to the application user or anonymous `*`.

Auth files do not replicate as database rows; provision the necessary entries
locally on every host. Retain HTTP Basic Auth. Keep real env/auth files and curl
credential configs under `/etc/cubs/cluster`, outside Git, with read-only mounts.
Inspect the container's numeric UID and ensure it can read its secrets without
world readability. Do not print secret files or full rendered Compose.

The origin overlay redirects its existing `rqlite_auth` secret to the protected
superset. Its original health credential remains valid. Preserve this overlay
on future deployments. The old single-host deployment helper generates a
different two-user file and is not the cluster deployment procedure.

## Prepare the existing origin

1. Inspect `/nodes?nonvoters&timeout=5s` and relevant authenticated `/status` fields. Record the actual
   node ID, Raft address, volume and Docker network. Verify an authorized backup
   and its readability before the first stateful reconfiguration.
2. Enroll the origin Linux environment into the private Cloudflare network.
   Route its existing advertised container `/32`; check overlaps, forwarding,
   return traffic and direct reachability from both sites.
3. Fill `/etc/cubs/cluster/origin.env` from `docker/cluster.origin.env.example`.
   The Docker IP/network must match the current running node. Keep its existing
   Compose project so its named volume resolves to the same production volume.
4. Declare the brief origin restart, retained image/state and auth extension.
   Validate the merged Compose quietly, then recreate only rqlite with
   `--no-deps` when routing and the two sites are ready. Confirm the same node ID,
   recorded Raft address and data volume before starting any peer.

Example shape; discover real paths and project instead of assuming this path:

```bash
cd /srv/cubs/cubs-backend
compose_origin=(docker compose -p docker \
  --env-file docker/rqlite.prod.env --env-file /etc/cubs/cluster/origin.env \
  -f docker/docker-compose.prod.yml -f docker/docker-compose.cluster-origin.yml \
  --profile edge)
"${compose_origin[@]}" config --quiet
# Only after the origin gates above:
"${compose_origin[@]}" up -d --no-deps rqlite
```

Do not treat a singleton Raft address migration as an ordinary restart. If the
old address cannot be retained/routed, stop for an explicit migration/recovery
plan rather than resetting state or choosing another node ID.

## Join the candidates

Clone/pull the published backend on each Linux host. Codex can discover this
skill in `.agents/skills/cubs-linux-cluster-deploy`. Use the Videira/Rio do Sul env
example, fill the assigned Mesh IPv4 and existing origin's private Raft endpoint,
and keep `CLUSTER_NON_VOTER=true` initially. Use separate Compose projects:
`cubs-ifc-videira` and `cubs-ifc-riodosul`.

Confirm each new data volume is absent or empty before its first start. Do not
erase a nonempty volume or copy the origin's Raft directory onto another peer.

In Videira (substitute project/env in Rio do Sul):

```bash
cd /srv/cubs/cubs-backend
compose_peer=(docker compose -p cubs-ifc-videira \
  --env-file /etc/cubs/cluster/videira.env \
  -f docker/docker-compose.cluster-peer.yml)
"${compose_peer[@]}" config --quiet
"${compose_peer[@]}" build rqlite
"${compose_peer[@]}" up -d --no-deps rqlite
"${compose_peer[@]}" ps
```

This is a standalone database-only stack, not an application replica. Never
combine its YAML with the original production YAML or run it on the original
origin. Do not add `--bootstrap-expect=3`, disable auth or delete volumes to
work around a failed JOIN. Inspect connectivity/auth/advertised endpoints.

Verify authenticated `/readyz`, `/nodes?nonvoters&timeout=5s`, and per-node `/status`. Run the skill's
TCP preflight on all three hosts and verify all advertised addresses. Both new
IDs must appear as non-voters, and their commit/applied indexes must converge
while an existing record can be queried on each node. TCP success or a healthy
Cloudflare connector does not prove membership or replication.

Always include `nonvoters` during enrollment: the default `/nodes` response
omits candidate non-voters. Seeing only the origin in that default response
does not mean the JOIN failed.

## Convert to three voters for the requested campus availability

The installed 10.3.3 does **not** expose `/promote`. Its JOIN implementation
ignores an unchanged ID/address even when the requested voter flag differs.
Do not copy the newer documentation's promotion API, invent a flag that changes
existing membership, or upgrade the origin merely to follow that documentation.

Three voters are required for the requested one-campus outage tolerance.
The tested conversion for this version is a planned stop/remove/rejoin of each **new non-voter only**. Never
apply this procedure to the origin or an existing voting member.

For the first candidate, verify `/nodes?nonvoters&timeout=5s` shows it as
`voter: false`, all three are reachable/caught up, and its persistent data
volume, ID and advertised address are recorded. Stop just this candidate on
its host, preserving its volume. From the current leader, remove only this
stopped non-voter's membership with the protected operator credential:

```bash
curl --fail --silent --show-error --config /etc/cubs/cluster/operator.curl \
  --header 'Content-Type: application/json' --request DELETE \
  --data '{"id":"ifc-videira"}' "$LEADER_HTTP/remove"
```

Confirm the candidate disappeared from membership. On its own host set
`CLUSTER_NON_VOTER=false` in the protected env, retain its exact ID/address/data
volume and keep `CLUSTER_JOIN_PEERS` pointing at the live private cluster.
Run the same `compose_peer up -d --no-deps rqlite` to rejoin it as a voter.
Verify it is reachable, `voter: true`, ready and caught up before proceeding.

Repeat only for the still-non-voting `ifc-riodosul`. The intermediate two-voter
state requires both voters, so neither may be stopped. The final target is
three voters, one leader, quorum two. Keep voter env settings for future starts.
If any check fails, preserve every volume and the remaining quorum; stop rather
than removing additional members. On later rqlite versions, inspect that
version's supported role-change API and test it before choosing a procedure.

## Later rollouts

The cluster tolerates one failed voter, not two lost sites. Measure cross-site
latency because writes wait for a majority. Database quorum does not provide
automatic API/frontend failover. A live failure/restart rehearsal must be in
scope and preserve at least two healthy voters.

For app rollouts retain the origin Compose overlay/auth, tag old app images,
build only the affected app, and check new-image migration status (`pending: []`)
before `up -d --no-deps`. Do not recreate rqlite for an app-only rollout. A saved
application image is not a way to undo cluster membership; preserve Raft state
and stop before force recovery/removal.

## Primary references

- [Clustering, quorum and address changes](https://rqlite.io/docs/clustering/general-guidelines/)
- [Flags: join, join-as and non-voters](https://rqlite.io/docs/guides/config/)
- [Cluster authentication and node TLS](https://rqlite.io/docs/guides/security/)
- [Monitoring, including non-voters](https://rqlite.io/docs/guides/monitoring-rqlite/)
- [Pinned 10.3.3 JOIN implementation](https://github.com/rqlite/rqlite/blob/v10.3.3/store/store.go)
- [Pinned 10.3.3 HTTP endpoints](https://github.com/rqlite/rqlite/blob/v10.3.3/http/service.go)
