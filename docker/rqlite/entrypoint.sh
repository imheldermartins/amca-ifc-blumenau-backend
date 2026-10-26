#!/bin/sh
set -eu
ADV_IP=${RQLITE_ADVERTISE_IP:-$(hostname -i | awk '{print $1}')}
set -- -node-id "${NODE_ID:-1}" \
  -http-addr '0.0.0.0:4001' -raft-addr '0.0.0.0:4002' \
  -http-adv-addr "${ADV_IP}:${RQLITE_HTTP_ADVERTISE_PORT:-4001}" \
  -raft-adv-addr "${ADV_IP}:4002"
if [ -n "${RQLITE_AUTH_FILE:-}" ]; then
  [ -s "$RQLITE_AUTH_FILE" ] && [ -r "$RQLITE_AUTH_FILE" ] || {
    echo 'Required rqlite authentication file is missing or unreadable' >&2
    exit 1
  }
  set -- "$@" -auth "$RQLITE_AUTH_FILE"
fi
if [ -n "${RQLITE_HTTP_ALLOW_ORIGIN:-}" ]; then
  set -- "$@" -http-allow-origin "$RQLITE_HTTP_ALLOW_ORIGIN"
fi
if [ -n "${JOIN_NODE:-}" ]; then
  set -- "$@" -join "$JOIN_NODE"
fi
exec rqlited "$@" /rqlite/file
