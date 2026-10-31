#!/usr/bin/env bash
# Ежедневный бэкап сервера, у которого нет своего backup.sh (srv-erp): mongodump + фото -> один .tgz.
# Cron ставит install-smb.sh --with-backup (03:30). Дом свой бэкап делает backup.sh — там этот файл не нужен.
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/data-core}"
DATA_DIR="${DATA_DIR:-/var/lib/datacore}"
BACKUP_DIR="${BACKUP_DIR:-$DATA_DIR/backups}"
BACKUP_PREFIX="${BACKUP_PREFIX:-srv-erp}"
KEEP_LOCAL="${KEEP_LOCAL:-3}"
MONGO_CONTAINER="${MONGO_CONTAINER:-datacore-mongo}"
MONGO_DB="${MONGO_DB:-datacore}"
[[ -f "$APP_DIR/.env" ]] && { set -a; . "$APP_DIR/.env"; set +a; }

STAMP="$(date +%Y%m%d-%H%M)"
OUT="$BACKUP_DIR/${BACKUP_PREFIX}-${STAMP}.tgz"
TMP="$BACKUP_DIR/.tmp-${STAMP}"
mkdir -p "$BACKUP_DIR"; rm -rf "$TMP"; mkdir -p "$TMP"
trap 'rm -rf "$TMP"' EXIT

echo "== Бэкап $(date)"
# логин и пароль берутся из переменных самого контейнера, в командной строке их нет
docker exec "$MONGO_CONTAINER" sh -c "mongodump --quiet -u \"\$MONGO_INITDB_ROOT_USERNAME\" -p \"\$MONGO_INITDB_ROOT_PASSWORD\" --authenticationDatabase admin --db $MONGO_DB --gzip --archive" > "$TMP/mongo.archive.gz"
[[ -s "$TMP/mongo.archive.gz" ]] || { echo "СТОП: пустой дамп Mongo" >&2; exit 2; }
if [[ -d "$DATA_DIR/uploads" ]]; then tar -C "$DATA_DIR" -czf "$TMP/uploads.tgz" uploads; fi
tar -C "$TMP" -czf "$OUT.part" .
gzip -t "$OUT.part"
mv "$OUT.part" "$OUT"
echo "готово: $OUT ($(du -h "$OUT" | cut -f1))"

# локально хранить KEEP_LOCAL последних
ls -1t "$BACKUP_DIR/${BACKUP_PREFIX}"-*.tgz 2>/dev/null | tail -n +"$((KEEP_LOCAL + 1))" | xargs -r rm -f --
