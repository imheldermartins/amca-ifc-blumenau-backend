#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ENTRYPOINT="$SCRIPT_DIR/entrypoint.sh"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT HUP INT TERM

touch "$TMP_DIR/ca.crt" "$TMP_DIR/node.crt" "$TMP_DIR/node.key"

assert_contains() {
    output=$1
    expected=$2
    echo "$output" | grep -F -- "$expected" >/dev/null || {
        echo "Esperava encontrar: $expected" >&2
        echo "$output" >&2
        exit 1
    }
}

assert_fails_with() {
    expected=$1
    shift
    error_file="$TMP_DIR/error"

    if "$@" >"$TMP_DIR/output" 2>"$error_file"; then
        echo "Comando deveria falhar" >&2
        exit 1
    fi

    grep -F -- "$expected" "$error_file" >/dev/null || {
        cat "$error_file" >&2
        exit 1
    }
}

leader_output=$(env \
    RQLITE_DRY_RUN=true \
    RQLITE_NODE_ID=wsl-leader \
    RQLITE_NODE_ROLE=leader \
    RQLITE_NETWORK_MODE=tailscale \
    RQLITE_HTTP_ADV_ADDR=100.64.0.1:8001 \
    RQLITE_RAFT_ADV_ADDR=100.64.0.1:4003 \
    sh "$ENTRYPOINT")

assert_contains "$leader_output" 'Node: wsl-leader (leader)'
assert_contains "$leader_output" '<-http-adv-addr> <100.64.0.1:8001>'
assert_contains "$leader_output" '<-raft-adv-addr> <100.64.0.1:4003>'

joined_output=$(env \
    RQLITE_DRY_RUN=true \
    RQLITE_NODE_ID=termux-replica \
    RQLITE_NODE_ROLE=non-voter \
    RQLITE_NETWORK_MODE=tunnel \
    RQLITE_HTTP_ADV_ADDR=5.tcp.ngrok.io:12344 \
    RQLITE_RAFT_ADV_ADDR=4.tcp.ngrok.io:12345 \
    RQLITE_JOIN_ADDRS=8.tcp.ngrok.io:23456 \
    RQLITE_NODE_CERT="$TMP_DIR/node.crt" \
    RQLITE_NODE_KEY="$TMP_DIR/node.key" \
    RQLITE_NODE_CA_CERT="$TMP_DIR/ca.crt" \
    RQLITE_NODE_VERIFY_CLIENT=true \
    RQLITE_COMPRESS_SNAPSHOT_TRANSPORT=true \
    sh "$ENTRYPOINT")

assert_contains "$joined_output" '<-raft-non-voter>'
assert_contains "$joined_output" '<-join> <8.tcp.ngrok.io:23456>'
assert_contains "$joined_output" '<-node-verify-client>'
assert_contains "$joined_output" '<-compress-snap-transport>'

assert_fails_with 'node voter exige RQLITE_JOIN_ADDRS' env \
    RQLITE_DRY_RUN=true \
    RQLITE_NODE_ROLE=voter \
    RQLITE_NETWORK_MODE=direct \
    sh "$ENTRYPOINT"

assert_fails_with 'network_mode=tunnel exige TLS entre nodes' env \
    RQLITE_DRY_RUN=true \
    RQLITE_NODE_ROLE=leader \
    RQLITE_NETWORK_MODE=tunnel \
    RQLITE_HTTP_ADV_ADDR=http.tunnel.example:18001 \
    RQLITE_RAFT_ADV_ADDR=raft.tunnel.example:14003 \
    sh "$ENTRYPOINT"

assert_fails_with 'RQLITE_NODE_CERT e RQLITE_NODE_KEY devem ser definidos juntos' env \
    RQLITE_DRY_RUN=true \
    RQLITE_NODE_ROLE=leader \
    RQLITE_NETWORK_MODE=direct \
    RQLITE_NODE_CERT="$TMP_DIR/node.crt" \
    sh "$ENTRYPOINT"

legacy_output=$(env \
    RQLITE_DRY_RUN=true \
    NODE_ID=legacy-worker \
    RQLITE_ADVERTISE_IP=10.0.0.2 \
    JOIN_NODE=10.0.0.1:4002 \
    sh "$ENTRYPOINT")

assert_contains "$legacy_output" 'Node: legacy-worker (voter)'
assert_contains "$legacy_output" '<-join> <10.0.0.1:4002>'

echo 'entrypoint rqlite: OK'
