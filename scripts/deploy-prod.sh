#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"
bootstrap=false
check_only=false
target=all
for argument in "$@"; do
  case "$argument" in
    --bootstrap-auth) bootstrap=true ;;
    --check) check_only=true ;;
    backend|frontend|all) target=$argument ;;
    *) echo 'Usage: bash scripts/deploy-prod.sh [--bootstrap-auth] [--check] [backend|frontend|all]' >&2; exit 2 ;;
  esac
done
fail() { echo "$*" >&2; exit 1; }
for command in docker flock git sha256sum; do command -v "$command" >/dev/null || fail "Required command: $command"; done
[[ -f docker/backend.prod.env && -f docker/rqlite.prod.env ]] || fail 'Copy the production env examples and configure the existing stack first.'
if ! $check_only; then
  [[ -z $(git status --porcelain) ]] || fail 'Commit reviewed changes before deployment.'
  [[ $(git rev-parse HEAD) == "$(git rev-parse '@{upstream}')" ]] || fail 'Push the source commit before deployment.'
fi
mkdir -p docker/.generated
protect() {
  local file=$1
  if [[ "$ROOT" =~ ^/mnt/[a-z]/ ]]; then
    command -v powershell.exe >/dev/null || fail 'Windows PowerShell is required to restrict secrets on NTFS.'
    powershell.exe -NoProfile -NonInteractive -File "$(wslpath -w "$ROOT/scripts/deploy/protect-secrets.ps1")" -Path "$(wslpath -w "$file")"
  elif [[ -d "$file" ]]; then chmod 700 "$file"; else chmod 600 "$file"; fi
}
# Protect staging before any password is generated, including atomic temp files.
protect "$ROOT/docker/.generated"
protect "$ROOT/docker/rqlite.prod.env"
exec 9>docker/.generated/deploy.lock
flock -n 9 || fail 'Another deployment is running.'
NODE_IMAGE=$(awk '/^FROM node:/{print $2;exit}' Dockerfile)
[[ -n "$NODE_IMAGE" ]] || fail 'Missing pinned Node image in Dockerfile.'
prepare=(docker run --rm --network none --user "$(id -u):$(id -g)" --mount "type=bind,src=$ROOT/docker,dst=/config" --mount "type=bind,src=$ROOT/scripts/deploy/config.mjs,dst=/task/config.mjs,readonly" "$NODE_IMAGE" node /task/config.mjs /config)
$bootstrap && prepare+=(--bootstrap-auth)
"${prepare[@]}"
protect "$ROOT/docker/.generated"
protect "$ROOT/docker/rqlite.prod.env"
for file in docker/.generated/rqlite-auth.json docker/.generated/rqlite-health.curl; do protect "$ROOT/$file"; done
compose=(docker compose -p docker --env-file docker/rqlite.prod.env -f docker/docker-compose.prod.yml --profile edge)
# Compose gives shell exports precedence over --env-file. Credentials and node
# settings must come from the reviewed production file, not a stale shell.
unset RQLITE_USERNAME RQLITE_PASSWORD RQLITE_READER_USERNAME RQLITE_READER_PASSWORD
unset NODE_ID RQLITE_ADVERTISE_IP RQLITE_HTTP_ADVERTISE_PORT JOIN_NODE RQLITE_HTTP_ALLOW_ORIGIN
"${compose[@]}" config --quiet
$check_only && { echo 'Credential preparation, permissions and Compose validation passed; no services changed.'; exit 0; }

stamp=$(date -u +%Y%m%dT%H%M%SZ)
report="$ROOT/docker/.generated/deploy-$stamp"
mkdir -p "$report"; protect "$report"
trap 'echo "Deployment stopped. Inspect service health; retain authentication and the volume. Recovery manifest: $report" >&2' ERR
for service in backend rqlite frontend cloudflared; do
  state=$(docker inspect --format '{{.State.Status}}' "cubs-$service")
  [[ "$state" == running ]] || fail "Start and verify the existing $service container before deployment."
done
for service in backend rqlite; do
  [[ $(docker inspect --format '{{.State.Health.Status}}' "cubs-$service") == healthy ]] || fail "$service must be healthy before deployment."
done
for service in backend rqlite frontend; do
  old=$(docker inspect --format '{{.Image}}' "cubs-$service")
  docker tag "$old" "cubs-$service:rollback-$stamp"
  printf '%s %s %s\n' "$service" "$old" "cubs-$service:rollback-$stamp" >>"$report/previous-images.txt"
done
wait_healthy() {
  local service=$1
  for ((attempt=0; attempt<45; attempt++)); do
    [[ $(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "cubs-$service") == healthy ]] && return 0
    sleep 2
  done
  fail "$service did not become healthy. Authentication has not been disabled."
}
verify_auth() {
  "${compose[@]}" run --rm --no-deps --entrypoint node \
    -v "$ROOT/scripts/deploy/verify.mjs:/task/verify.mjs:ro" \
    -v "$ROOT/docker/.generated/rqlite-auth.json:/run/secrets/rqlite_auth:ro" backend /task/verify.mjs "$1"
}
# Builds are explicit; the ordinary application rollout never recreates dependencies.
build=()
[[ $target != frontend ]] && build+=(backend)
[[ $target != backend ]] && build+=(frontend)
$bootstrap && build+=(rqlite)
"${compose[@]}" build "${build[@]}"
if $bootstrap; then
  [[ $target != frontend ]] || fail 'Authentication bootstrap must include the backend.'
  verify_auth bootstrap
else
  verify_auth auth
  live_hash=$(docker exec cubs-rqlite sha256sum /run/secrets/rqlite_auth | awk '{print $1}')
  source_hash=$(sha256sum docker/.generated/rqlite-auth.json | awk '{print $1}')
  [[ "$live_hash" == "$source_hash" ]] || fail 'Credential changes require a coordinated rotation; no services changed.'
fi
if [[ $target != frontend ]]; then
  "${compose[@]}" run --rm --no-deps --entrypoint /app/node_modules/.bin/rqlite backend migrate status --config /app/dist/rqlite.config.js --environment production >"$report/migrations-before.json"
  docker run --rm -i --network none "$NODE_IMAGE" node -e 'let s="";for await(const c of process.stdin)s+=c;const v=JSON.parse(s);if(!Array.isArray(v.pending)||v.pending.length){console.error("Pending migrations require explicit review; no services changed.");process.exit(1)}' <"$report/migrations-before.json"
  "${compose[@]}" up -d --no-deps backend
  wait_healthy backend
fi
if $bootstrap; then
  # Retain a backend that supports credentials, rather than reverting to one that cannot log in.
  docker tag "$(docker inspect --format '{{.Image}}' cubs-backend)" "cubs-backend:auth-compatible-$stamp"
  "${compose[@]}" stop backend rqlite
  volume=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/rqlite/file"}}{{.Name}}{{end}}{{end}}' cubs-rqlite)
  [[ "$volume" == docker_rqlite_data ]] || fail 'Unexpected production data volume.'
  docker run --rm --network none --read-only --mount "type=volume,src=$volume,dst=/data,readonly" \
    --mount "type=bind,src=$report,dst=/backup" --entrypoint tar "cubs-rqlite:rollback-$stamp" -czf /backup/rqlite-data.tar.gz -C /data .
  protect "$report/rqlite-data.tar.gz"
  "${compose[@]}" up -d --no-deps rqlite
  wait_healthy rqlite
  verify_auth auth
  "${compose[@]}" up -d --no-deps backend
  wait_healthy backend
fi
if [[ $target != backend ]]; then "${compose[@]}" up -d --no-deps frontend; fi
# Refresh nginx DNS after a backend container replacement, including backend-only rollouts.
docker exec cubs-frontend nginx -t
docker exec cubs-frontend nginx -s reload
docker exec cubs-frontend wget -q --spider http://127.0.0.1/
verify_auth auth
"${compose[@]}" run --rm --no-deps --entrypoint /app/node_modules/.bin/rqlite backend migrate status --config /app/dist/rqlite.config.js --environment production >"$report/migrations-after.json"
docker exec cubs-backend node -e 'const r=await fetch("http://127.0.0.1:3000/health/ready");if(!r.ok)process.exit(1);console.log("Backend readiness:",r.status,await r.text())' --input-type=module
docker exec cubs-backend node --input-type=module -e 'for(const u of ["https://cubsonline.com.br","https://api.cubsonline.com.br/health/ready","https://api.cubsonline.com.br/socket.io/?EIO=4&transport=polling"]){const r=await fetch(u);if(!r.ok)process.exit(1);if(u.includes("socket.io")&&!(await r.text()).startsWith("0{"))process.exit(1);console.log(u,r.status)}'
docker inspect --format '{{.Name}} image={{.Image}} created={{.Created}} state={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{end}}' cubs-backend cubs-frontend cubs-rqlite cubs-cloudflared | tee "$report/containers.txt"
echo "Deployment verified. Rollback image tags and protected backup/report: $report"
