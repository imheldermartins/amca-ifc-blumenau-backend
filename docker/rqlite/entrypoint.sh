#!/bin/sh

ADV_IP=${RQLITE_ADVERTISE_IP:-$(hostname -i | awk '{print $1}')}

echo "=== Iniciando Nó rqlite ==="
echo "IP Anunciado (Advertise IP): $ADV_IP"

NODE_ID=${NODE_ID:-1}
HTTP_ADDR="0.0.0.0:4001"
RAFT_ADDR="0.0.0.0:4002"

HTTP_ADV_ADDR="${ADV_IP}:8000"
RAFT_ADV_ADDR="${ADV_IP}:4002"

# Build arguments list
ARGS="-node-id ${NODE_ID} -http-addr ${HTTP_ADDR} -raft-addr ${RAFT_ADDR} -http-adv-addr ${HTTP_ADV_ADDR} -raft-adv-addr ${RAFT_ADV_ADDR}"

# CORS: valor do header Access-Control-Allow-Origin. O padrão CORS só aceita
# UMA origem (ou *) nesse header, então a env é um valor único — não é lista.
# Só protege contra chamadas de browser; client direto (curl) não passa por
# CORS — a restrição real é o bind da porta no compose (RQLITE_ALLOWED_HOST).
if [ -n "$RQLITE_HTTP_ALLOW_ORIGIN" ]; then
    echo "CORS Allow-Origin: $RQLITE_HTTP_ALLOW_ORIGIN"
    ARGS="$ARGS -http-allow-origin $RQLITE_HTTP_ALLOW_ORIGIN"
fi

if [ -n "$JOIN_NODE" ]; then
    echo "Modo: WORKER"
    JOIN_ADDR=$JOIN_NODE
    
    echo "Juntando-se ao cluster pelo líder: $JOIN_ADDR"
    ARGS="$ARGS -join $JOIN_ADDR"
else
    echo "Modo: LEADER"
fi

# The data directory MUST be the last argument
echo "Executando: rqlited $ARGS /rqlite/file"
exec rqlited $ARGS /rqlite/file
