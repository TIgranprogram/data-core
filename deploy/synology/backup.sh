#!/bin/bash
# backup.sh — MongoDB + uploads (Personal Data Core)
# Контур: datacore-mongo / БД datacore (адаптировано из kppdf 2026-10-17).
# Запуск на VM: cd /opt/data-core && bash deploy/synology/backup.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
[[ -f "$ENV_FILE" ]] && set -a && source "$ENV_FILE" && set +a

# data-core defaults (можно переопределить в deploy/synology/.env)
DATA_DIR="${DATA_DIR:-/var/lib/datacore}"
MONGO_CONTAINER="${MONGO_CONTAINER:-datacore-mongo}"
MONGO_DB="${MONGO_DB:-datacore}"

# Mongo с --auth (задача B): дамп берём от root-пользователя.
# Пароль приходит из .env (MONGO_ROOT_PASSWORD) — в скрипте не хранится.
MONGO_ROOT_USER="${MONGO_ROOT_USER:-root}"
if [[ -z "${MONGO_ROOT_PASSWORD:-}" ]]; then
  echo "ERROR: MONGO_ROOT_PASSWORD is not set (deploy/synology/.env)" >&2
  exit 1
fi

DOCKER="${DOCKER_CMD:-docker}"
DATE="$(date +%Y-%m-%d_%H%M)"
BACKUP_ROOT="${DATA_DIR}/backups"

mkdir -p "$BACKUP_ROOT"

echo "=== Data Core backup ($(date)) ==="
echo "    mongo container: ${MONGO_CONTAINER}, db: ${MONGO_DB}"

# mongodump внутри контейнера → копия на хост
$DOCKER exec "$MONGO_CONTAINER" mongodump \
  --username "$MONGO_ROOT_USER" \
  --password "$MONGO_ROOT_PASSWORD" \
  --authenticationDatabase admin \
  --db "$MONGO_DB" \
  --out "/tmp/dump-${DATE}"
$DOCKER cp "${MONGO_CONTAINER}:/tmp/dump-${DATE}" "${BACKUP_ROOT}/mongo-${DATE}"
$DOCKER exec "$MONGO_CONTAINER" rm -rf "/tmp/dump-${DATE}"

if [[ -d "${DATA_DIR}/uploads" ]]; then
  cp -a "${DATA_DIR}/uploads" "${BACKUP_ROOT}/uploads-${DATE}"
fi

# --- Rotation: remove backups older than BACKUP_RETENTION_DAYS ---
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
if [[ "$RETENTION_DAYS" -gt 0 ]]; then
  echo "=== Rotation: removing backups older than ${RETENTION_DAYS} days ==="
  DELETED=0
  while IFS= read -r dir; do
    echo "  removing: $(basename "$dir")"
    rm -rf "$dir"
    DELETED=$((DELETED + 1))
  done < <(find "$BACKUP_ROOT" -maxdepth 1 -type d \( -name 'mongo-*' -o -name 'uploads-*' \) -mtime "+${RETENTION_DAYS}")
  echo "  removed ${DELETED} old backup(s)"
else
  echo "=== Rotation disabled (BACKUP_RETENTION_DAYS=0) ==="
fi

echo "Done: ${BACKUP_ROOT}"
