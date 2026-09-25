#!/bin/sh
set -eu
# The package owns migration loading, waiting and artifact readiness.
rqlite() { /app/node_modules/.bin/rqlite "$@" --config /app/dist/rqlite.config.js --environment production; }
if [ "${WAIT_FOR_DATABASE:-true}" = "true" ]; then rqlite wait; fi
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then rqlite migrate; fi
rqlite check --database
exec "$@"
