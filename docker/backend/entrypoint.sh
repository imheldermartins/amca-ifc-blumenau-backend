#!/bin/sh
set -eu

if [ "${WAIT_FOR_DATABASE:-true}" = "true" ]; then
    echo "[backend] Aguardando conexão com o rqlite..."
    node dist/core/scripts/wait-for-database.js
fi

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
    echo "[backend] Aplicando migrations pendentes..."
    node dist/core/scripts/migrate.js
fi

echo "[backend] Iniciando aplicação..."
exec "$@"
