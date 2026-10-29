# Private connectivity and public cutover

## Public names and certificates

Use the approved single-label hostnames `ifc-blumenau.cubsonline.com.br`,
`ifc-videira.cubsonline.com.br`, `ifc-riodosul.cubsonline.com.br`. On 2026-10-29,
the account's active Universal certificate covered `*.cubsonline.com.br` and the
apex. The user selected hyphenated names to avoid buying ACM. Recheck exact
certificate/DNS coverage; do not revert to deeper `ifc.<campus>` names.

Create one public Tunnel identity per physical campus. Route only its public
hostname to its local `http://frontend:80`; local nginx proxies API/socket to
its local backend. Reusing the same tunnel token on all campuses makes replicas
of one ingress, not three separately addressable campus deployments.

In Blumenau, reuse the current tunnel/containers while changing the serving
hostname. First prepare its new route/DNS and verify TLS. Rebuild frontend for
the new same-origin API and set backend APP_PUBLIC_URL/CORS accordingly. Preserve
the existing data volume and project. After the new host passes public checks,
retire only the old apex/API/www application routes requested by the user.
Do not stop/delete the database or tunnel first. Preserve MX/SPF/DKIM/DMARC.
The campus nginx default server returns 404 for retired/unrecognized hosts.

## Cloudflare Mesh (private network)

Public cloudflared Tunnel is not bidirectional L3 connectivity for rqlite/Raft.
Use Cloudflare Mesh (formerly WARP Connector), separate participant identity and
Mesh IPv4 on each host. The current account had no configured Mesh nodes or
Cloudflare One team name during the audit. A Codex login does not enroll devices.

Verify current vendor instructions and account settings. Networking > Mesh >
Add participant > Add node currently creates a team, names a node, restricts
who can enroll, then supplies installation/registration instructions. Use a
team such as `cubs-ifc` if available, with enrollment restricted to the account
owner; do not broaden it to everyone. Follow applicable tool action-time
confirmation requirements before creating security-sensitive access.

Use a Traffic and DNS/MASQUE device profile, unique IPs, device reachability,
Gateway TCP/UDP and split tunnel inclusion of the configured Mesh CIDR (default
100.96.0.0/12). Configure this before connecting unattended hosts; preserve
current public tunnel reachability and avoid an unexpected full-route change.
Obtain participant tokens privately. Never paste tokens into prompts, Git,
command logs or shell history. Keep enrollment local to each physical PC.

Required all-pairs TCP paths: rqlite HTTP4001 and Raft4002, Valkey6379 and
Sentinel26379. Bind published ports only to Mesh IPs, restrict to the three host
identities, and keep public interfaces closed. Inspect actual Docker forwarding
rules; Docker publishing can bypass simple UFW policies. Backend containers also
need routes to advertised database and Sentinel-selected Valkey endpoints.

## Existing Blumenau address and data

Audit snapshot: rqlite v10.3.3, node ID `1`, recorded Raft172.19.0.2:4002,
HTTP172.19.0.2:4001, Docker network docker_default/172.19.0.0/16, one voter;
warp-cli absent. Recheck these on the live host before applying overlays.

A new Mesh IP cannot casually replace the persisted Raft address. The origin
overlay pins the existing container IP on its existing external Docker network.
Advertise only its audited container /32 through the Blumenau Mesh participant,
with forwarding and return path verified from both remote sites and actual app
containers. Check Docker/LAN/VPN overlaps on all sites. Mesh host port mapping
alone does not make the old advertised container IP reachable.

If that /32 cannot be routed reliably, prepare an explicit backed-up address
migration; do not erase Raft state, edit peers.json or bootstrap an empty origin.
For new peers use nonoverlapping local Docker networks and their Mesh IPs as
advertised addresses. Future JOIN lists should contain surviving peers, not only
Blumenau. Once three voters exist, do not restart/remove two together.

## Sources

- [Mesh concepts](https://developers.cloudflare.com/mesh/concepts/)
- [Mesh setup](https://developers.cloudflare.com/mesh/get-started/)
- [Routes and return paths](https://developers.cloudflare.com/mesh/features/routes/)
- [Universal SSL coverage](https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/limitations/)
