#!/bin/sh
set -eu
umask 077
: "${CLUSTER_MESH_IP:?Set this host's Mesh IPv4}"
: "${COORDINATION_MODE:?Use data or sentinel}"
: "${COORDINATION_PRIMARY_IP:?Set the initial primary Mesh IPv4}"
secret=$(cat /run/secrets/cluster_redis)
case "$secret" in *[!a-fA-F0-9]*|'') echo 'Expected a protected hex coordination secret' >&2; exit 1;; esac
[ "${#secret}" -ge 64 ] && [ "${#secret}" -le 128 ] || exit 1
for address in "$CLUSTER_MESH_IP" "$COORDINATION_PRIMARY_IP"; do
  echo "$address" | awk -F. 'NF != 4 {exit 1} {for(i=1;i<=4;i++) if ($i !~ /^[0-9]+$/ || $i>255) exit 1;
    if (!($1==10 || ($1==172 && $2>=16 && $2<=31) || ($1==192 && $2==168) || ($1==100 && $2>=96 && $2<=111))) exit 1}' || exit 1
done
if [ "$COORDINATION_MODE" = data ]; then
  config=/data/cubs-valkey.conf
  if [ ! -f "$config" ]; then
    cat > "$config" <<EOF
bind 0.0.0.0
protected-mode yes
port 6379
dir /data
appendonly yes
requirepass $secret
masterauth $secret
replica-announce-ip $CLUSTER_MESH_IP
replica-announce-port 6379
min-replicas-to-write 1
min-replicas-max-lag 10
EOF
    if [ "$CLUSTER_MESH_IP" != "$COORDINATION_PRIMARY_IP" ]; then
      echo "replicaof $COORDINATION_PRIMARY_IP 6379" >> "$config"
    fi
  fi
elif [ "$COORDINATION_MODE" = sentinel ]; then
  config=/data/cubs-sentinel.conf
  if [ ! -f "$config" ]; then
    cat > "$config" <<EOF
bind 0.0.0.0
protected-mode yes
port 26379
dir /data
requirepass $secret
sentinel monitor cubs-campus $COORDINATION_PRIMARY_IP 6379 2
sentinel auth-pass cubs-campus $secret
sentinel sentinel-pass $secret
sentinel announce-ip $CLUSTER_MESH_IP
sentinel announce-port 26379
sentinel down-after-milliseconds cubs-campus 10000
sentinel failover-timeout cubs-campus 60000
sentinel parallel-syncs cubs-campus 1
EOF
  fi
else
  echo 'Unknown coordination mode' >&2; exit 1
fi
# Sentinel and CONFIG REWRITE retain elections across container recreation.
# Do not regenerate an initialized configuration or force the initial primary.
if [ "$COORDINATION_MODE" = sentinel ]; then
  exec /usr/local/bin/docker-entrypoint.sh valkey-server "$config" --sentinel
fi
exec /usr/local/bin/docker-entrypoint.sh valkey-server "$config"
