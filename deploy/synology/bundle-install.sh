#!/bin/bash
# install.sh — развернуть переносной пакет (БЗ-13) на сервере, в том числе на СОВСЕМ ПУСТОЙ Ubuntu 22.04/24.04.
# Кладётся в пакет bundle.sh'ем. Запуск (из распакованной папки пакета):
#   sudo bash install.sh                 — поставить всё, поднять data-core и kppdf, перенести данные в ПУСТУЮ базу
#   sudo TUNNEL_PORT=4210 bash install.sh — то же + включить туннель к VPS на этом порту (СВОЙ порт новой VM, см. MIGRATE.md)
# Безопасно повторять: что уже стоит — пропускает; в непустую базу данные НЕ льёт (стоп), туннель без TUNNEL_PORT не включает.
# set -x НЕ использовать: в пакете секреты (.env).
set -euo pipefail
cd "$(dirname "$0")"
PKG="$(pwd)"
[[ $EUID -eq 0 ]] || { echo "Нужен root: sudo bash install.sh"; exit 1; }
[[ -f manifest.json && -f mongo/datacore.archive.gz ]] || { echo "Запускать из распакованной папки пакета"; exit 1; }
OWNER="${SUDO_USER:-root}"
say() { echo; echo "== $*"; }

say "1. Система: пакеты, Docker, защита"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl git autossh cron ufw tzdata >/dev/null
timedatectl set-timezone Europe/Moscow 2>/dev/null || true
if ! command -v docker >/dev/null; then curl -fsSL https://get.docker.com | sh >/dev/null; fi
docker compose version >/dev/null || { echo "нет docker compose"; exit 1; }
[[ "$OWNER" != root ]] && usermod -aG docker "$OWNER" || true
systemctl enable --now docker cron >/dev/null
ufw allow 22/tcp >/dev/null; ufw --force enable >/dev/null   # снаружи только SSH; 3000/3001/27017 слушают 127.0.0.1
if [[ $(free -m | awk '/Mem:/{print $2}') -lt 4000 && -z "$(swapon --show)" ]]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
grep -q avx /proc/cpuinfo || echo "   CPU без AVX — используется mongo:4.4 (так в compose)"

say "2. Код и настройки"
mkdir -p /opt
for p in data-core kppdf; do
  [[ -f code/$p.tar.gz ]] || continue
  tmp=$(mktemp -d); tar -xzf code/$p.tar.gz -C "$tmp"
  src="$tmp/$(ls "$tmp" | head -1)"; dst=/opt/$([[ $p == kppdf ]] && echo kppdf-8.0 || echo data-core)
  [[ -d "$dst" ]] && mv "$dst" "$dst.prev-$(date +%Y%m%d%H%M)"
  mv "$src" "$dst"; rm -rf "$tmp"
done
cp_cfg() { [[ -f "config/$1" ]] && { install -m 600 "config/$1" "$2"; echo "   $2"; } || true; }
cp_cfg data-core/.env /opt/data-core/.env
cp_cfg data-core/deploy-synology.env /opt/data-core/deploy/synology/.env
cp_cfg kppdf/.env /opt/kppdf-8.0/.env
cp_cfg kppdf/.kppdf-mongo-pw /opt/kppdf-8.0/.kppdf-mongo-pw
chown -R "$OWNER" /opt/data-core /opt/kppdf-8.0 2>/dev/null || true
DATA_DIR=$(grep -E '^DATA_DIR=' /opt/data-core/.env | cut -d= -f2- | tr -d '"'); DATA_DIR=${DATA_DIR:-/var/lib/datacore}
mkdir -p "$DATA_DIR"/{mongodb,uploads,backups}

say "3. Фото"
[[ -f uploads/data-core-uploads.tar.gz ]] && tar -xzf uploads/data-core-uploads.tar.gz -C "$DATA_DIR"
if [[ -f uploads/kppdf-uploads-sources.txt ]]; then
  i=0; while IFS= read -r src; do i=$((i+1)); mkdir -p "$(dirname "$src")"; tar -xzf "uploads/kppdf-uploads-$i.tar.gz" -C "$(dirname "$src")"; done < uploads/kppdf-uploads-sources.txt
fi
chown -R "$OWNER" "$DATA_DIR" 2>/dev/null || true

say "4. База: Mongo, rs0, пользователи"
cd /opt/data-core
docker compose -f docker-compose.prod.yml up -d mongo-keyfile mongo mongo-init mongo-appuser 2>&1 | tail -2
for i in $(seq 1 60); do [[ "$(docker inspect -f '{{.State.Health.Status}}' datacore-mongo 2>/dev/null)" == healthy ]] && break; sleep 3; done
M='mongo --quiet -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin datacore'
docs=$(docker exec datacore-mongo sh -c "$M --eval 'var n=0;db.getCollectionNames().forEach(function(c){n+=db.getCollection(c).estimatedDocumentCount()});print(n)'" | tail -1)
if [[ "${docs:-0}" -gt 0 ]]; then
  echo "СТОП: база не пустая ($docs документов). Данные из пакета не переносятся — решает человек."
else
  docker exec -i datacore-mongo sh -c 'mongorestore -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --gzip --archive --quiet' < "$PKG/mongo/datacore.archive.gz"
  echo "   данные перенесены"
fi

say "5. Приложения"
docker compose -f docker-compose.prod.yml up -d --build 2>&1 | tail -2
if [[ -d /opt/kppdf-8.0 ]]; then
  (cd /opt/kppdf-8.0 && f=$(ls docker-compose.prod.yml docker-compose.yml 2>/dev/null | head -1) && [[ -n "$f" ]] && docker compose -f "$f" up -d --build 2>&1 | tail -2) || echo "   kppdf: поднять вручную (см. его README)"
fi

say "6. Бэкап по расписанию"
if [[ -f "$PKG/config/cron.d/datacore" ]]; then install -m 644 "$PKG/config/cron.d/datacore" /etc/cron.d/datacore
else echo "0 3 * * * $OWNER cd /opt/data-core && bash deploy/synology/backup.sh >> /var/log/datacore-backup.log 2>&1" > /etc/cron.d/datacore; fi

say "7. Туннель к VPS"
if [[ -n "${TUNNEL_PORT:-}" ]]; then
  echo "   порт $TUNNEL_PORT — скрипт туннеля и ключ VM: deploy/synology/datacore-tunnel.sh (ключ VM — НОВЫЙ, добавить на VPS)"
  [[ -f /opt/data-core/deploy/synology/datacore-tunnel.sh ]] && sed -i "s/^REMOTE_PORT=.*/REMOTE_PORT=$TUNNEL_PORT/" /opt/data-core/deploy/synology/datacore-tunnel.sh || true
else
  echo "   не включён (нет TUNNEL_PORT) — домен пока ведёт на старую VM. Переключение — MIGRATE.md"
fi

say "8. Проверка"
sleep 10
for u in http://127.0.0.1:3001/api/health/ready http://127.0.0.1:3001/app/ http://127.0.0.1:3000/; do printf '   %s → %s\n' "$u" "$(curl -s -o /dev/null -w '%{http_code}' "$u")"; done
docker exec datacore-mongo sh -c "$M --eval 'print(db.getCollectionNames().length+\" коллекций\")'" | tail -1 | sed 's/^/   /'
echo "   сверка с пакетом: manifest.json → collections (число документов по коллекциям)"
echo; echo "Готово. Дальше: проверить вход в приложение, затем — переключение домена (MIGRATE.md)."
