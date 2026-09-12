#!/bin/sh

set -eu

fail() {
    echo "ERRO de configuracao do rqlite: $*" >&2
    exit 1
}

is_true() {
    case "${1:-}" in
        1|true|TRUE|yes|YES|on|ON) return 0 ;;
        *) return 1 ;;
    esac
}

require_pair() {
    first_name=$1
    first_value=$2
    second_name=$3
    second_value=$4

    if { [ -n "$first_value" ] && [ -z "$second_value" ]; } || \
       { [ -z "$first_value" ] && [ -n "$second_value" ]; }; then
        fail "$first_name e $second_name devem ser definidos juntos"
    fi
}

require_readable_file() {
    variable_name=$1
    file_path=$2

    if [ -n "$file_path" ] && [ ! -r "$file_path" ]; then
        fail "$variable_name aponta para arquivo inexistente ou sem leitura: $file_path"
    fi
}

# Nomes antigos continuam aceitos para nao quebrar os ambientes existentes.
NODE_ID=${RQLITE_NODE_ID:-${NODE_ID:-1}}
JOIN_ADDRS=${RQLITE_JOIN_ADDRS:-${JOIN_NODE:-}}
NETWORK_MODE=${RQLITE_NETWORK_MODE:-direct}

if [ -n "${RQLITE_NODE_ROLE:-}" ]; then
    NODE_ROLE=$RQLITE_NODE_ROLE
elif [ -n "$JOIN_ADDRS" ]; then
    NODE_ROLE=voter
else
    NODE_ROLE=leader
fi

HTTP_ADDR=${RQLITE_HTTP_BIND_ADDR:-0.0.0.0:4001}
RAFT_ADDR=${RQLITE_RAFT_BIND_ADDR:-0.0.0.0:4002}

ADV_HOST=${RQLITE_ADVERTISE_HOST:-${RQLITE_ADVERTISE_IP:-}}
if [ -z "$ADV_HOST" ]; then
    ADV_HOST=$(hostname -i | awk '{print $1}')
fi

HTTP_ADV_ADDR=${RQLITE_HTTP_ADV_ADDR:-${ADV_HOST}:${RQLITE_HTTP_ADV_PORT:-8000}}
RAFT_ADV_ADDR=${RQLITE_RAFT_ADV_ADDR:-${ADV_HOST}:${RQLITE_RAFT_ADV_PORT:-4002}}

[ -n "$NODE_ID" ] || fail "RQLITE_NODE_ID nao pode ser vazio"
[ -n "$HTTP_ADV_ADDR" ] || fail "RQLITE_HTTP_ADV_ADDR nao pode ser vazio"
[ -n "$RAFT_ADV_ADDR" ] || fail "RQLITE_RAFT_ADV_ADDR nao pode ser vazio"

case "$NETWORK_MODE" in
    direct|tailscale|tunnel) ;;
    *) fail "RQLITE_NETWORK_MODE deve ser direct, tailscale ou tunnel" ;;
esac

case "$NODE_ROLE" in
    leader)
        [ -z "$JOIN_ADDRS" ] || fail "node leader nao deve definir RQLITE_JOIN_ADDRS"
        ;;
    voter|non-voter)
        [ -n "$JOIN_ADDRS" ] || fail "node $NODE_ROLE exige RQLITE_JOIN_ADDRS com o Raft anunciado de outro node"
        ;;
    *) fail "RQLITE_NODE_ROLE deve ser leader, voter ou non-voter" ;;
esac

if [ "$NETWORK_MODE" = "tailscale" ] || [ "$NETWORK_MODE" = "tunnel" ]; then
    case "$HTTP_ADV_ADDR,$RAFT_ADV_ADDR" in
        *0.0.0.0:*|*127.0.0.1:*|*localhost:*)
            fail "enderecos anunciados em $NETWORK_MODE devem ser alcancaveis pelos outros nodes"
            ;;
    esac
fi

require_pair RQLITE_HTTP_CERT "${RQLITE_HTTP_CERT:-}" RQLITE_HTTP_KEY "${RQLITE_HTTP_KEY:-}"
require_pair RQLITE_NODE_CERT "${RQLITE_NODE_CERT:-}" RQLITE_NODE_KEY "${RQLITE_NODE_KEY:-}"

require_readable_file RQLITE_AUTH_FILE "${RQLITE_AUTH_FILE:-}"
require_readable_file RQLITE_HTTP_CERT "${RQLITE_HTTP_CERT:-}"
require_readable_file RQLITE_HTTP_KEY "${RQLITE_HTTP_KEY:-}"
require_readable_file RQLITE_HTTP_CA_CERT "${RQLITE_HTTP_CA_CERT:-}"
require_readable_file RQLITE_NODE_CERT "${RQLITE_NODE_CERT:-}"
require_readable_file RQLITE_NODE_KEY "${RQLITE_NODE_KEY:-}"
require_readable_file RQLITE_NODE_CA_CERT "${RQLITE_NODE_CA_CERT:-}"

if [ -n "${RQLITE_JOIN_AS:-}" ] && [ -z "${RQLITE_AUTH_FILE:-}" ]; then
    fail "RQLITE_JOIN_AS exige RQLITE_AUTH_FILE"
fi

if is_true "${RQLITE_HTTP_VERIFY_CLIENT:-}" && [ -z "${RQLITE_HTTP_CA_CERT:-}" ]; then
    fail "RQLITE_HTTP_VERIFY_CLIENT exige RQLITE_HTTP_CA_CERT"
fi

if is_true "${RQLITE_NODE_VERIFY_CLIENT:-}" && [ -z "${RQLITE_NODE_CA_CERT:-}" ]; then
    fail "RQLITE_NODE_VERIFY_CLIENT exige RQLITE_NODE_CA_CERT"
fi

if { is_true "${RQLITE_NODE_NO_VERIFY:-}" || \
     [ -n "${RQLITE_NODE_VERIFY_SERVER_NAME:-}" ] || \
     [ -n "${RQLITE_NODE_VERIFY_COMMON_NAME:-}" ]; } && [ -z "${RQLITE_NODE_CERT:-}" ]; then
    fail "opcoes de verificacao node-to-node exigem RQLITE_NODE_CERT/KEY"
fi

if [ "$NETWORK_MODE" = "tunnel" ] && ! is_true "${RQLITE_ALLOW_INSECURE_TUNNEL:-}"; then
    [ -n "${RQLITE_NODE_CERT:-}" ] || fail "network_mode=tunnel exige TLS entre nodes; defina RQLITE_NODE_CERT/KEY ou RQLITE_ALLOW_INSECURE_TUNNEL=true somente para teste descartavel"
fi

echo "=== Iniciando node rqlite ==="
echo "Node: $NODE_ID ($NODE_ROLE)"
echo "Rede: $NETWORK_MODE"
echo "HTTP bind/anuncio: $HTTP_ADDR -> $HTTP_ADV_ADDR"
echo "Raft bind/anuncio: $RAFT_ADDR -> $RAFT_ADV_ADDR"

set -- \
    -node-id "$NODE_ID" \
    -http-addr "$HTTP_ADDR" \
    -raft-addr "$RAFT_ADDR" \
    -http-adv-addr "$HTTP_ADV_ADDR" \
    -raft-adv-addr "$RAFT_ADV_ADDR"

if [ "$NODE_ROLE" = "non-voter" ]; then
    set -- "$@" -raft-non-voter
fi

if [ -n "$JOIN_ADDRS" ]; then
    echo "Join Raft: $JOIN_ADDRS"
    set -- "$@" -join "$JOIN_ADDRS"
fi

if [ -n "${RQLITE_JOIN_AS:-}" ]; then
    set -- "$@" -join-as "$RQLITE_JOIN_AS"
fi

if [ -n "${RQLITE_JOIN_ATTEMPTS:-}" ]; then
    set -- "$@" -join-attempts "$RQLITE_JOIN_ATTEMPTS"
fi

if [ -n "${RQLITE_JOIN_INTERVAL:-}" ]; then
    set -- "$@" -join-interval "$RQLITE_JOIN_INTERVAL"
fi

if [ -n "${RQLITE_HTTP_ALLOW_ORIGIN:-}" ]; then
    echo "CORS HTTP API: $RQLITE_HTTP_ALLOW_ORIGIN"
    set -- "$@" -http-allow-origin "$RQLITE_HTTP_ALLOW_ORIGIN"
fi

if [ -n "${RQLITE_AUTH_FILE:-}" ]; then
    set -- "$@" -auth "$RQLITE_AUTH_FILE"
fi

if [ -n "${RQLITE_HTTP_CERT:-}" ]; then
    set -- "$@" -http-cert "$RQLITE_HTTP_CERT" -http-key "$RQLITE_HTTP_KEY"
fi

if [ -n "${RQLITE_HTTP_CA_CERT:-}" ]; then
    set -- "$@" -http-ca-cert "$RQLITE_HTTP_CA_CERT"
fi

if is_true "${RQLITE_HTTP_VERIFY_CLIENT:-}"; then
    set -- "$@" -http-verify-client
fi

if [ -n "${RQLITE_NODE_CERT:-}" ]; then
    set -- "$@" -node-cert "$RQLITE_NODE_CERT" -node-key "$RQLITE_NODE_KEY"
fi

if [ -n "${RQLITE_NODE_CA_CERT:-}" ]; then
    set -- "$@" -node-ca-cert "$RQLITE_NODE_CA_CERT"
fi

if is_true "${RQLITE_NODE_VERIFY_CLIENT:-}"; then
    set -- "$@" -node-verify-client
fi

if is_true "${RQLITE_NODE_NO_VERIFY:-}"; then
    set -- "$@" -node-no-verify
fi

if [ -n "${RQLITE_NODE_VERIFY_SERVER_NAME:-}" ]; then
    set -- "$@" -node-verify-server-name "$RQLITE_NODE_VERIFY_SERVER_NAME"
fi

if [ -n "${RQLITE_NODE_VERIFY_COMMON_NAME:-}" ]; then
    set -- "$@" -node-verify-common-name "$RQLITE_NODE_VERIFY_COMMON_NAME"
fi

if is_true "${RQLITE_COMPRESS_SNAPSHOT_TRANSPORT:-}"; then
    set -- "$@" -compress-snap-transport
fi

DATA_DIR=${RQLITE_DATA_DIR:-/rqlite/file}

if is_true "${RQLITE_DRY_RUN:-}"; then
    printf 'rqlited'
    printf ' <%s>' "$@" "$DATA_DIR"
    printf '\n'
    exit 0
fi

exec rqlited "$@" "$DATA_DIR"
