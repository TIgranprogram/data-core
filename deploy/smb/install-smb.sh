#!/usr/bin/env bash
# Разовая установка отправки копий по SMB — одинаково на любом сервере (дом и Sportin). Под обычным пользователем, sudo не нужен:
#   bash deploy/smb/install-smb.sh [--with-backup]
#   --with-backup  ещё и ежедневный бэкап SRV-ERP/backup-erp.sh — там, где нет своего (Sportin); на доме бэкап делает backup.sh.
# Каталог файлов доступа монтируется в backend самим docker-compose.prod.yml (одинаково на обоих серверах).
# Сервер сам отмечает, что отправка установлена (offsite-smb.sh --poll раз в минуту → settings.smbAgentAt) — админка это видит.
# Повторный запуск безопасен: строки crontab без дублей.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-/opt/data-core}"
DATA_DIR="${DATA_DIR:-/var/lib/datacore}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
SEND_AT="${SEND_AT:-0 4 * * *}"; BACKUP_AT="${BACKUP_AT:-30 3 * * *}"
WITH_BACKUP=0; [[ "${1:-}" == "--with-backup" ]] && WITH_BACKUP=1

echo "== Образ smbclient"
docker build -q -t datacore-smbclient "$DIR" >/dev/null
echo "== Каталоги"
mkdir -p "$DATA_DIR/smb" "$DATA_DIR/backups"
# каталог мог создать docker (владелец root) — вернуть себе через контейнер, без sudo
[[ -O "$DATA_DIR/smb" ]] || docker run --rm -v "$DATA_DIR:/d" datacore-smbclient chown "$(id -u):$(id -g)" /d/smb
chmod 700 "$DATA_DIR/smb"
echo "== Backend видит общий каталог?"
if docker exec datacore-backend test -d "$DATA_DIR/smb"; then echo "да"; else
  echo "нет — пересоздаю backend (несколько секунд)"
  (cd "$APP_DIR" && docker compose -f "$COMPOSE_FILE" up -d --no-deps backend 2>&1 | tail -2)
fi
echo "== crontab"
chmod +x "$DIR"/*.sh
LINES=("* * * * * bash $DIR/offsite-smb.sh --poll >> $DATA_DIR/smb/poll.log 2>&1" "$SEND_AT bash $DIR/offsite-smb.sh >> $DATA_DIR/smb/send.log 2>&1")
[[ $WITH_BACKUP == 1 ]] && LINES+=("$BACKUP_AT bash $APP_DIR/SRV-ERP/backup-erp.sh >> $DATA_DIR/backups/backup-erp.log 2>&1")
# строки прежнего места скриптов (SRV-ERP/offsite-smb.sh) — убрать, иначе отправка дважды
CUR="$(crontab -l 2>/dev/null | grep -v 'SRV-ERP/offsite-smb.sh' || true)"
for L in "${LINES[@]}"; do
  # дубль — строка с той же командой (без времени и журнала); «offsite-smb.sh» и «offsite-smb.sh --poll» — разные
  cmd="$(echo "$L" | cut -d' ' -f6- | sed 's/ >>.*//')"
  CUR="$(printf '%s\n' "$CUR" | awk -v c="$cmd" '{ x = $0; sub(/^([^ ]+ ){5}/, "", x); sub(/ >>.*/, "", x); if (x != c) print }')"
  CUR="$(printf '%s\n%s\n' "$CUR" "$L")"
done
printf '%s\n' "$CUR" | sed '/^$/d' | crontab -
crontab -l | grep -F -e "$DIR" -e backup-erp.sh || true
echo "Готово. Место для копий — в админке: Сервер → Копии вне дома → Сетевая папка (SMB)."
