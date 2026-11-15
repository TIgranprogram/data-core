#!/usr/bin/env bash
# pull-backup.sh — свежая копия data-core с VM на этот ПК (Linux/Ubuntu; для Windows — pull-backup.ps1, логика та же).
#   bash deploy/backup-pull/pull-backup.sh [папка]   (по умолчанию $DC_BACKUPS или ~/datacore-backups)
# 1. Находит самую новую /var/lib/datacore/backups/mongo-<ts> на VM (cron backup.sh).
# 2. Пакует mongo-<ts> (+ uploads-<ts>) во /tmp на VM, скачивает в <папка>/datacore-<ts>.tgz,
#    сверяет размер и архив (до 3 попыток), убирает временный файл на VM.
# 3. Оставляет только самую новую проверенную копию (правило владельца 2026-11-13).
# Уже есть datacore-<ts>.tgz — ничего не качает. Адрес и ключ: VM/KEY из окружения (как release.sh),
# иначе DEPLOY_HOST/DEPLOY_USER/DEPLOY_SSH_KEY из deploy/synology/config.env (секреты не печатаются). Журнал: <папка>/pull.log
set -euo pipefail
cd "$(dirname "$0")/../.."
DEST="${1:-${DC_BACKUPS:-$HOME/datacore-backups}}"
mkdir -p "$DEST"
LOG="$DEST/pull.log"
log() { local l; l="$(date '+%Y-%m-%d %H:%M:%S')  $1"; echo "$l" >> "$LOG"; echo "$l"; }
fail() { log "ERROR: $1"; exit 1; }
cfg() { grep -m1 "^$1=" deploy/synology/config.env 2>/dev/null | cut -d= -f2- | sed "s/^[\"']//; s/[\"']\$//" || true; }

if [ -n "${VM:-}" ]; then TARGET="$VM"; KEYF="${KEY:-}"
else
  [ -f deploy/synology/config.env ] || fail "нет deploy/synology/config.env"
  H="$(cfg DEPLOY_HOST)"; U="$(cfg DEPLOY_USER)"; KEYF="$(cfg DEPLOY_SSH_KEY)"
  [ -n "$H" ] && [ -n "$U" ] || fail "в config.env нет DEPLOY_HOST / DEPLOY_USER"
  TARGET="$U@$H"
  # ключ записан путём со старого Windows-ПК (C:\Users\…) — берём ключ сервера из ~/.ssh
  case "$KEYF" in ""|[A-Za-z]:*|*\\*) KEYF="$HOME/.ssh/kppdf80-vm";; "~"*) KEYF="$HOME${KEYF#\~}";; esac
fi
OPTS=(-o BatchMode=yes -o ConnectTimeout=20 -o StrictHostKeyChecking=accept-new)
[ -n "$KEYF" ] && OPTS+=(-i "$KEYF")

LATEST="$(ssh "${OPTS[@]}" "$TARGET" 'ls -1d /var/lib/datacore/backups/mongo-* 2>/dev/null | tail -1')" || fail "не удалось прочитать список копий на VM"
[ -n "$LATEST" ] || fail "на VM нет копий mongo-*"
TS="${LATEST##*/mongo-}"
FILE="$DEST/datacore-$TS.tgz"

if [ -f "$FILE" ]; then log "свежая: datacore-$TS.tgz уже есть"
else
  RT="/tmp/datacore-pull-$TS.tgz"
  OUT="$(ssh "${OPTS[@]}" "$TARGET" "cd /var/lib/datacore/backups && tar -czf $RT mongo-$TS \$(test -d uploads-$TS && echo uploads-$TS) && echo PACKED")" || true
  [[ "$OUT" == *PACKED* ]] || fail "не упаковалось на VM: $OUT"
  RSIZE="$(ssh "${OPTS[@]}" "$TARGET" "stat -c %s $RT 2>/dev/null" || echo 0)"
  TMP="$FILE.part"; OK=0
  for TRY in 1 2 3; do
    rm -f "$TMP"
    if ! scp -q "${OPTS[@]}" "$TARGET:$RT" "$TMP"; then log "попытка $TRY: scp не скачал"; sleep 5; continue; fi
    GOT="$(stat -c %s "$TMP")"
    if [ "${RSIZE:-0}" -gt 0 ] && [ "$GOT" != "$RSIZE" ]; then log "попытка $TRY: обрезан, $GOT из $RSIZE байт"; sleep 5; continue; fi
    if ! tar -tzf "$TMP" >/dev/null 2>&1; then log "попытка $TRY: архив битый"; sleep 5; continue; fi
    OK=1; break
  done
  ssh "${OPTS[@]}" "$TARGET" "rm -f $RT" >/dev/null 2>&1 || true
  [ $OK = 1 ] || { rm -f "$TMP"; fail "не скачалось за 3 попытки: datacore-$TS.tgz ($RSIZE байт на VM)"; }
  mv -f "$TMP" "$FILE"
  log "скачана datacore-$TS.tgz ($(( $(stat -c %s "$FILE") / 1024 )) КБ)"
fi

[ -f "$FILE" ] || fail "нет свежей копии после скачивания: $FILE"
for f in "$DEST"/datacore-*.tgz; do [ "$f" = "$FILE" ] || { rm -f "$f"; log "убрана старая ${f##*/}"; }; done
exit 0
