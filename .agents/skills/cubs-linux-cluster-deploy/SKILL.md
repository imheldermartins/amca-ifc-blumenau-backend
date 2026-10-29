---
name: cubs-linux-cluster-deploy
description: Deploy the full Cub's stack by IFC campus on Linux (Blumenau, Videira, Rio do Sul), enroll private Cloudflare Mesh hosts and join the shared rqlite cluster. Use for campus deployments or JOIN; preserve the original cubs-wsl-deploy skill.
---

# Cub's Linux Campus Deploy

Use Bash, native Docker Engine/Compose v2, Python 3 and curl on the actual target
Linux host. Discover repository paths; do not embed Windows paths, WSL launchers
or Docker Desktop in remote commands. The existing Blumenau host currently runs
Docker inside Ubuntu WSL; execute its Linux commands inside that existing Ubuntu.
The other two hosts are native Linux.

## Target the physical campus

| Campus | Public hostname | Persistent database ID | Stack |
| --- | --- | --- | --- |
| Blumenau | `ifc-blumenau.cubsonline.com.br` | existing `1` | existing project/volume |
| Videira | `ifc-videira.cubsonline.com.br` | `ifc-videira` | `cubs-ifc-videira` |
| Rio do Sul | `ifc-riodosul.cubsonline.com.br` | `ifc-riodosul` | `cubs-ifc-riodosul` |

Blumenau replaces the existing apex application on the SAME machine and volume.
Do not start a second origin/database here. All three campuses run frontend,
API, notification worker and a local database member using the same data.
Three voters (quorum two) tolerate one unavailable campus, not two. A public
campus URL itself does not move to another machine automatically: users can
open a surviving campus URL. Do not claim an automatic public load balancer.

A shared Codex login or Chrome Control installation does not grant a remote
shell. Use an available authorized SSH session, or execute Codex locally on the
requested PC. Never emulate another campus with more containers on this host.

On first setup, verify which physical PC this is and bind it once:

```bash
python3 "$SKILL_DIR/scripts/campus.py" --bind --site videira --public-host ifc-videira.cubsonline.com.br
```

Set `SKILL_DIR` to this checked-in skill directory. Before every mutation:

```bash
python3 "$SKILL_DIR/scripts/campus.py" --site videira --public-host ifc-videira.cubsonline.com.br
```

Use the requested campus, not the example. The binding at `/etc/cubs/campus.json`
checks Linux machine-id, site and hostname. Do not copy it to other hosts or
rewrite a mismatch just to make a deployment succeed. If the target differs,
use its real session. Treat a request such as "deploy ifc-videira.cubsonline.com.br"
as targeting Videira only, with frontend/backend inferred from authorized changes.

## Select the work

- **Audit/publish skill:** inspect and prepare artifacts without enrolling live nodes.
- **Connect campuses:** establish private routes/auth, join candidates and verify
  replication before converting the two new members to voters.
- **Application deploy:** use the host's saved active Compose files/project/env;
  rebuild affected applications only. Do not change membership for an app deploy.

Existing user authorization persists. Obtain genuinely missing host sessions,
network enrollment or private configuration through a secure channel. Do not
print tokens, passwords, full Docker environments or rendered Compose secrets.
Do not rotate existing secrets, delete volumes, force-bootstrap Raft, buy paid
features or apply gated migrations as a side effect. Original skill stays intact.

## Read the relevant runbook

- First connection/domain cutover: [networking](references/networking.md).
- Database membership/auth: [cluster](references/cluster.md).
- Full application deployment, coordination and failover: [applications](references/applications.md).

Record each host's Git SHAs, Compose project/files, image versions/digests,
Mesh IPv4, node ID, recorded HTTP/Raft addresses, voter status, networks/subnets,
data volume and protected credential file paths. Inspect authenticated
`/nodes?nonvoters&timeout=5s` and selected `/status` fields; never dump secrets.

Use `assets/cluster.example.json` for the three-host inventory. Fill actual Mesh
IPs and endpoints, retaining the existing node's audited address. Validate:

```bash
python3 "$SKILL_DIR/scripts/preflight.py" --inventory /etc/cubs/cluster/inventory.json --inventory-only
python3 "$SKILL_DIR/scripts/preflight.py" --inventory /etc/cubs/cluster/inventory.json --local-node ifc-videira
```

Run network checks on all three hosts (Blumenau uses `--local-node 1`). TCP
success is not proof of authentication, replication or failover.

## Checked-in configuration

- `docker/docker-compose.prod.yml`: original production stack, retained in Blumenau.
- `docker/docker-compose.cluster-origin.yml`: preserve its network, recorded IP,
  project and volume; publish private ports and mount the auth superset.
- `docker/docker-compose.cluster-peer.yml`: JOIN-required database for the two
  new PCs. Never merge the peer and origin YAMLs or run a peer on the origin.
- `docker/docker-compose.campus-coordination.yml`: one Valkey data member and
  Sentinel per host, private ports, persistent elections; primary plus two replicas.
- `docker/docker-compose.campus-app.yml`: full local application + campus tunnel,
  same-origin API/socket, shared rate limits and cross-API realtime.
- `docker/docker-compose.campus-transition.yml`: temporary public-name cutover
  on the original single API while remote hosts are being enrolled. This phase
  does not provide HA; replace with the full campus app overlay once ready.
- `docker/cluster.{blumenau,videira,riodosul}.env.example`: nonsecret templates.

These files do not create Mesh participants, routes, DNS or credentials. Keep
real env/auth files outside Git under `/etc/cubs/cluster`. Preserve matching
JWT and database credentials across the APIs. Keep each campus's own tunnel
identity so a URL never randomly selects a different campus connector.

## Verify and report

Back up the initialized origin before its first stateful cluster change. Never
change its recorded Raft address by replacing an env value. Follow the pinned
10.3.3 runbook for stop/remove/rejoin of NEW non-voters only; no `/promote` API.
Never stop two voters together. Keep at least two healthy voting members.

For app deployments, tag rollback images, build explicitly, check migrations
with the new image (`pending: []`), then recreate only affected app services via
`up -d --no-deps`. Backend first when both change; reload nginx after backend
replacement. Preserve the host's active campus overlays on every later deploy.

Require authenticated local DB readiness, application readiness including
coordination, nginx validation, public HTTPS/API/socket handshake and a safe
cross-campus edit check. Before claiming HA, rehearse losing Blumenau and verify
reads/writes, notifications and realtime in the surviving two campuses. State
which checks used disposable fixtures and which ran on real campus hosts.
Report commit/image IDs, actual nodes/voters, preserved volumes, public URLs,
rollback tags and missing inputs. Never claim that publishing YAML joined hosts.
