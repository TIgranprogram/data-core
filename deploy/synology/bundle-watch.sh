#!/bin/bash
# bundle-watch.sh — мост «админка → хост» для переносного пакета (БЗ-13).
# Запускается cron'ом пользователя (tiit) каждую минуту:
#   * * * * * DATA_DIR=/var/lib/datacore bash /opt/data-core/deploy/synology/bundle-watch.sh
# Контейнер backend не умеет запускать docker на хосте, поэтому приложение лишь кладёт файл-запрос
#   ${DATA_DIR}/bundle-requests/request
# а этот скрипт его подхватывает, запускает bundle.sh и пишет ${DATA_DIR}/bundle-requests/status.json.
# Готовые пакеты — ${DATA_DIR}/bundles (в контейнере: /host-bundles, только чтение).
#
# Идемпотентен: нет запроса — тихо выходит; уже работает другой экземпляр (flock) — тихо выходит.
# Переменные: DATA_DIR (/var/lib/datacore), DC_DIR (/opt/data-core), BUNDLE_KEEP (2).
# set -x НЕ использовать: bundle.sh читает .env, трассировка напечатала бы секреты.
set -uo pipefail
umask 077

DATA_DIR="${DATA_DIR:-/var/lib/datacore}"
DC_DIR="${DC_DIR:-/opt/data-core}"
KEEP="${BUNDLE_KEEP:-2}"
REQ_DIR="${DATA_DIR}/bundle-requests"
OUT_DIR="${DATA_DIR}/bundles"
REQ="${REQ_DIR}/request"
STATUS="${REQ_DIR}/status.json"
LOG="${OUT_DIR}/bundle.log"

mkdir -p "$REQ_DIR" "$OUT_DIR"
# в каталоге запросов пишет процесс из контейнера (другой uid): sticky-бит, как у /tmp
chmod 1777 "$REQ_DIR" 2>/dev/null || true
chmod 700 "$OUT_DIR" 2>/dev/null || true

[[ -e "$REQ" ]] || exit 0

exec 9>"${REQ_DIR}/.lock"
flock -n 9 || exit 0   # сборка уже идёт

[[ -e "$REQ" ]] || exit 0
rm -f "$REQ"

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
# строка → JSON-строка (без python/node на хосте)
jstr() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr '\t' ' ' | sed -e ':a;N;$!ba;s/\n/\\n/g'; }
write_status() { local t; t="$(mktemp "${STATUS}.XXXXXX")" || return 1; printf '%s\n' "$1" > "$t" && chmod 644 "$t" && mv -f "$t" "$STATUS"; }

STARTED="$(now)"
write_status "{\"state\":\"running\",\"startedAt\":\"${STARTED}\"}"

# лог не растёт бесконечно: оставляем хвост прошлых сборок
[[ -f "$LOG" ]] && tail -n 500 "$LOG" > "${LOG}.old" && mv -f "${LOG}.old" "$LOG"
echo "=== $(now) сборка по запросу из админки ===" >> "$LOG"

BUNDLE_DIR="$OUT_DIR" BUNDLE_KEEP="$KEEP" DATA_DIR="$DATA_DIR" DC_DIR="$DC_DIR" \
  bash "${DC_DIR}/deploy/synology/bundle.sh" >> "$LOG" 2>&1
RC=$?
FINISHED="$(now)"

if [[ $RC -eq 0 ]]; then
  FILE="$(ls -1t "$OUT_DIR"/datacore-bundle-*.tar.gz 2>/dev/null | head -n 1)"
  if [[ -n "$FILE" ]]; then
    BYTES="$(stat -c %s "$FILE")"
    write_status "{\"state\":\"done\",\"startedAt\":\"${STARTED}\",\"finishedAt\":\"${FINISHED}\",\"file\":\"$(basename "$FILE")\",\"bytes\":${BYTES}}"
    exit 0
  fi
  RC=1
  echo "ERROR: bundle.sh завершился, но пакета нет" >> "$LOG"
fi

# последние строки лога; строки с возможными секретами отбрасываем
ERR="$(tail -n 30 "$LOG" | grep -viE 'pass|secret|token|key|jwt|mongodb(\+srv)?://' | tail -n 8)"
write_status "{\"state\":\"failed\",\"startedAt\":\"${STARTED}\",\"finishedAt\":\"${FINISHED}\",\"error\":\"$(jstr "$ERR")\"}"
exit 1
