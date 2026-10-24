#!/bin/bash
# backup.sh — MongoDB + uploads (Personal Data Core)
# Контур: datacore-mongo / БД datacore (адаптировано из kppdf 2026-10-17).
# Запуск на VM: cd /opt/data-core && bash deploy/synology/backup.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# .env: сначала рядом со скриптом (как исторически настроено на VM), иначе — корневой .env,
# который пишет deploy.py (/opt/data-core/.env). T17.
ENV_FILE="${SCRIPT_DIR}/.env"
[[ -f "$ENV_FILE" ]] || ENV_FILE="${SCRIPT_DIR}/../../.env"
[[ -f "$ENV_FILE" ]] && set -a && source "$ENV_FILE" && set +a

# data-core defaults (можно переопределить в deploy/synology/.env)
DATA_DIR="${DATA_DIR:-/var/lib/datacore}"
MONGO_CONTAINER="${MONGO_CONTAINER:-datacore-mongo}"
MONGO_DB="${MONGO_DB:-datacore}"

# Mongo с --auth (задача B): дамп берём от root-пользователя.
# Пароль приходит из .env (MONGO_ROOT_PASSWORD) — в скрипте не хранится.
MONGO_ROOT_USER="${MONGO_ROOT_USER:-root}"
if [[ -z "${MONGO_ROOT_PASSWORD:-}" ]]; then
  echo "ERROR: MONGO_ROOT_PASSWORD is not set (deploy/synology/.env или корневой .env)" >&2
  exit 1
fi

DOCKER="${DOCKER_CMD:-docker}"
# Секунды в имени: два запуска в одну минуту не пишут в одну папку (T19).
DATE="$(date +%Y-%m-%d_%H%M%S)"
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
# Дата папки бэкапа = момент бэкапа. Иначе cp -a переносит старую mtime исходной папки
# (после переноса фото kppdf она старше 14 дней) и ротация ниже сразу удаляет свежую копию.
touch "${BACKUP_ROOT}/mongo-${DATE}"
[[ -d "${BACKUP_ROOT}/uploads-${DATE}" ]] && touch "${BACKUP_ROOT}/uploads-${DATE}"

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
  # 2026-10-24: не больше BACKUP_KEEP последних копий каждого вида (выкладка тоже делает бэкап — копии копились десятками)
  KEEP="${BACKUP_KEEP:-10}"
  for kind in mongo uploads; do
    ls -1dt "$BACKUP_ROOT"/${kind}-20* 2>/dev/null | tail -n +$((KEEP + 1)) | while IFS= read -r dir; do
      echo "  removing (сверх ${KEEP}): $(basename "$dir")"; rm -rf "$dir"
    done
  done
else
  echo "=== Rotation disabled (BACKUP_RETENTION_DAYS=0) ==="
fi

echo "Done: ${BACKUP_ROOT}"
