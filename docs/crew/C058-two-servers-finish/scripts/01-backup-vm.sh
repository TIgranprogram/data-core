#!/usr/bin/env bash
# C058: бэкап Дома перед записью. Секреты не печатает.
set -euo pipefail
ssh -o BatchMode=yes -o ConnectTimeout=20 datacore-vm 'bash -s' <<'EOF'
set -euo pipefail
cd /opt/data-core
ts=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p /var/lib/datacore/backups/c058
cp -a .env "/var/lib/datacore/backups/c058/env-$ts.bak"
test -f "/var/lib/datacore/backups/c058/env-$ts.bak" && echo "ENV_BAK=ok $ts"
set -a; . ./.env; set +a
docker exec -e MONGO_ROOT_USER -e MONGO_ROOT_PASSWORD datacore-mongo sh -c \
  'mongodump --archive=/tmp/c058-pre.archive --gzip -u "$MONGO_ROOT_USER" -p "$MONGO_ROOT_PASSWORD" --authenticationDatabase admin --db datacore'
docker cp datacore-mongo:/tmp/c058-pre.archive "/var/lib/datacore/backups/c058/pre-$ts.archive.gz"
docker exec datacore-mongo rm -f /tmp/c058-pre.archive
ls -la "/var/lib/datacore/backups/c058/pre-$ts.archive.gz" | awk '{print "DUMP_BYTES",$5,"FILE",$9}'
echo BACKUP_VM_OK
EOF
