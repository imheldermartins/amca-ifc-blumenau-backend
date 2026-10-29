#!/bin/sh
# Native Linux peer launcher. The existing single-host entrypoint is unchanged.
set -eu
fail() { printf '%s\n' "$*" >&2; exit 1; }
private_ipv4() {
  case "$1" in ''|*[!0-9.]*|.*|*.|*..*) return 1 ;; esac
  private_ifs=$IFS
  IFS=.
  set -- $1
  IFS=$private_ifs
  [ "$#" = 4 ] || return 1
  for octet do
    [ "${#octet}" -le 3 ] && [ "$octet" -le 255 ] || return 1
  done
  case "$1.$2.$3.$4" in
    10.*|172.1[6-9].*|172.2[0-9].*|172.3[01].*|192.168.*|100.9[6-9].*|100.10[0-9].*|100.11[01].*) return 0 ;;
    *) return 1 ;;
  esac
}
[ -n "${NODE_ID:-}" ] || fail 'NODE_ID is required; never reuse another node ID.'
private_ipv4 "${RQLITE_ADVERTISE_IP:-}" || fail 'A private advertised IPv4 is required.'
[ -n "${JOIN_NODE:-}" ] || fail 'JOIN_NODE is required; refusing to bootstrap a separate cluster.'
case "$JOIN_NODE" in ,*|*,|*,,*) fail 'JOIN_NODE contains an empty peer.' ;; esac
[ -n "${RQLITE_JOIN_AS:-}" ] || fail 'An explicit cluster join user is required.'
[ -n "${RQLITE_AUTH_FILE:-}" ] && [ -s "$RQLITE_AUTH_FILE" ] && [ -r "$RQLITE_AUTH_FILE" ] || fail 'A readable, nonempty auth file is required.'
case "${RQLITE_NON_VOTER:-true}" in true|false) ;; *) fail 'RQLITE_NON_VOTER must be true or false.' ;; esac
saved_ifs=$IFS
IFS=,
for peer in $JOIN_NODE; do
  case "$peer" in *://*|*/*) fail 'JOIN_NODE must contain private Raft host:4002 endpoints, not URLs.' ;; esac
  case "$peer" in *:4002) ;; *) fail 'JOIN_NODE must use the Raft port 4002.' ;; esac
  private_ipv4 "${peer%:4002}" || fail 'Public and loopback join endpoints are not supported.'
done
IFS=$saved_ifs
set -- -node-id "$NODE_ID" \
  -http-addr '0.0.0.0:4001' -raft-addr '0.0.0.0:4002' \
  -http-adv-addr "$RQLITE_ADVERTISE_IP:4001" \
  -raft-adv-addr "$RQLITE_ADVERTISE_IP:4002" \
  -auth "$RQLITE_AUTH_FILE" -join-as "$RQLITE_JOIN_AS" -join "$JOIN_NODE"
[ "${RQLITE_NON_VOTER:-true}" = false ] || set -- "$@" -raft-non-voter
exec rqlited "$@" /rqlite/file
