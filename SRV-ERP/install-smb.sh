#!/usr/bin/env bash
# Разовая установка отправки копий по SMB. Запуск на сервере под обычным пользователем (sudo не нужен):
#   bash install-smb.sh [--with-backup]
#   --with-backup  ещё и ежедневный бэкап backup-erp.sh (srv-erp); на доме не нужен — там свой backup.sh.
# Повторный запуск безопасен: строки crontab без дублей.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-/opt/data-core}"
DATA_DIR="${DATA_DIR:-/var/lib/datacore}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
SEND_AT="${SEND_AT:-0 4 * * *}"; BACKUP_AT="${BACKUP_AT:-30 3 * * *}"
WITH_BACKUP=0; [[ "${1:-}" == "--with-backup" ]] && WITH_BACKUP=1

echo "== Образ smbclient"
docker build -q -t datacore-smbclient "$DIR/smb" >/dev/null
echo "== Каталоги"
mkdir -p "$DATA_DIR/smb" "$DATA_DIR/backups"; chmod 700 "$DATA_DIR/smb"
echo "== .env"
ENVF="$APP_DIR/.env"; [[ -f "$ENVF" ]] || { echo "СТОП: нет $ENVF" >&2; exit 2; }
if grep -q '^OFFSITE_SMB=' "$ENVF"; then sed -i 's/^OFFSITE_SMB=.*/OFFSITE_SMB=1/' "$ENVF"; else echo 'OFFSITE_SMB=1' >> "$ENVF"; fi
if ! grep -q '^BACKUP_SECRET_KEY=' "$ENVF"; then
  echo "BACKUP_SECRET_KEY=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')" >> "$ENVF"
  echo "добавлен BACKUP_SECRET_KEY (сохраните .env: без него пароли целей не расшифровать)"
fi
echo "== Перезапуск backend с общим каталогом"
(cd "$APP_DIR" && docker compose -f "$COMPOSE_FILE" -f "$DIR/smb/docker-compose.smb.yml" up -d --no-deps backend 2>&1 | tail -2)
echo "== crontab"
chmod +x "$DIR"/*.sh
LINES=("* * * * * bash $DIR/offsite-smb.sh --poll >> $DATA_DIR/smb/poll.log 2>&1" "$SEND_AT bash $DIR/offsite-smb.sh >> $DATA_DIR/smb/send.log 2>&1")
[[ $WITH_BACKUP == 1 ]] && LINES+=("$BACKUP_AT bash $DIR/backup-erp.sh >> $DATA_DIR/backups/backup-erp.log 2>&1")
CUR="$(crontab -l 2>/dev/null || true)"
for L in "${LINES[@]}"; do
  key="$(echo "$L" | grep -oE "bash $DIR/[a-z-]+\.sh( --poll)?")"
  CUR="$(printf '%s\n' "$CUR" | grep -vF "$key" || true)"
  CUR="$(printf '%s\n%s\n' "$CUR" "$L")"
done
printf '%s\n' "$CUR" | sed '/^$/d' | crontab -
crontab -l | grep -F "$DIR" || true
echo "Готово. Цель задаётся в админке (Копии вне дома -> Сетевая папка SMB)."
