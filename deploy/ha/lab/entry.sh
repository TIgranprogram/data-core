#!/bin/sh
# keyfile делается из LAB_KEY (тестовый), права 400 для mongodb
printf '%s' "$LAB_KEY" > /data/keyfile
chown mongodb:mongodb /data/keyfile
chmod 400 /data/keyfile
# shellcheck disable=SC2086
exec docker-entrypoint.sh mongod --replSet labrs --keyFile /data/keyfile --bind_ip_all \
  --oplogSize 256 --wiredTigerCacheSizeGB 0.25 $LAB_EXTRA
