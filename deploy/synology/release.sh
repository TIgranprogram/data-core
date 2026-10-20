#!/usr/bin/env bash
# Выкладка data-core на VM вручную по ssh (когда нет python/deploy.py) — по шагам skill `datacore-deploy`.
# Запуск из корня репо в Git Bash:   bash deploy/synology/release.sh [--data]
#   без флагов — только новая версия backend (бэкап → архив HEAD → замена backend/ deploy/ → build → up → проверка);
#   --data      — плюс разовые шаги с данными (после бэкапа): перенос дат счетов, загрузка Excel-заказов с фото,
#                 прошедшая отгрузка → «Отгружен». Каждый шаг повторно безопасен (ничего не задваивает).
# Mongo-контейнер и CRM kppdf не трогаются: пересобирается и перезапускается только datacore-backend.
set -euo pipefail
VM="${VM:-tiit@192.168.1.52}"
KEY="${KEY:-$HOME/.ssh/kppdf80-vm}"
ORDERS_DIR="${ORDERS_DIR:-для анализа/заказы}"
SSH=(ssh -i "$KEY" -o BatchMode=yes "$VM")
DATA=0; [[ "${1:-}" == "--data" ]] && DATA=1

cd "$(git rev-parse --show-toplevel)"
[[ -z "$(git status --porcelain -- backend deploy docker-compose.prod.yml)" ]] || { echo "Есть незакоммиченные изменения — сначала коммит"; exit 1; }
echo "== Версия: $(git log --oneline -1)"

echo "== 1. Бэкап базы на VM"
"${SSH[@]}" 'cd /opt/data-core && bash deploy/synology/backup.sh >/tmp/dc-backup.log 2>&1 && tail -1 /tmp/dc-backup.log'

echo "== 2. Архив и замена файлов (старые → *.prev-<время>)"
TMP="$(mktemp -d)"
git -c core.autocrlf=false archive --format=tar.gz -o "$TMP/release.tgz" HEAD backend docker-compose.prod.yml deploy
scp -i "$KEY" -o BatchMode=yes "$TMP/release.tgz" "$VM:/tmp/dc-release.tgz"
"${SSH[@]}" 'set -e; TS=$(date +%Y%m%d%H%M); R=/tmp/dc-rel-$TS; mkdir -p $R; tar -xzf /tmp/dc-release.tgz -C $R
  cp /opt/data-core/deploy/synology/.env $R/deploy/synology/.env 2>/dev/null || true
  cd /opt/data-core; mv backend backend.prev-$TS; mv deploy deploy.prev-$TS; cp docker-compose.prod.yml docker-compose.prod.yml.prev-$TS
  mv $R/backend backend; mv $R/deploy deploy; cp $R/docker-compose.prod.yml docker-compose.prod.yml; rm -rf $R; echo "заменено, откат: *.prev-$TS"'

echo "== 3. Сборка и перезапуск backend (mongo не трогаем)"
"${SSH[@]}" 'cd /opt/data-core && docker compose -f docker-compose.prod.yml build backend >/tmp/dc-build.log 2>&1 && tail -2 /tmp/dc-build.log && docker compose -f docker-compose.prod.yml up -d --no-deps backend'

echo "== 4. Проверка"
"${SSH[@]}" 'for i in $(seq 1 30); do s=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3001/api/health/ready); [ "$s" = 200 ] && break; sleep 3; done
  echo "data-core /api/health/ready: $s"; echo "/app/: $(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3001/app/)"; echo "/admin/: $(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3001/admin/)"
  echo "kppdf :3000: $(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/)"; docker ps --format "{{.Names}} {{.Status}}" | grep -E "datacore|kppdf"'

if [[ $DATA == 1 ]]; then
  echo "== 5. Данные (в контейнере datacore-backend, его MONGO_URI)"
  "${SSH[@]}" 'mkdir -p /tmp/dc-scripts /tmp/dc-orders'
  scp -i "$KEY" -o BatchMode=yes backend/scripts/migrate-invoice-date.js backend/scripts/import-orders-xlsx.js backend/scripts/orders-mark-shipped.js "$VM:/tmp/dc-scripts/"
  scp -i "$KEY" -o BatchMode=yes "$ORDERS_DIR"/*.xlsx "$VM:/tmp/dc-orders/"
  "${SSH[@]}" 'set -e; docker exec datacore-backend mkdir -p /app/scripts /tmp/orders
    docker cp /tmp/dc-scripts/. datacore-backend:/app/scripts/; docker cp /tmp/dc-orders/. datacore-backend:/tmp/orders/
    echo "-- даты счетов"; docker exec -w /app datacore-backend node scripts/migrate-invoice-date.js --apply | tail -3
    echo "-- заказы из Excel (+фото)"; docker exec -w /app datacore-backend node scripts/import-orders-xlsx.js /tmp/orders --photos --apply | tail -6
    echo "-- прошедшая отгрузка → «Отгружен»"; docker exec -w /app datacore-backend node scripts/orders-mark-shipped.js --apply | tail -1
    docker exec datacore-backend rm -rf /tmp/orders; rm -rf /tmp/dc-orders /tmp/dc-scripts'
fi
echo "== Готово. Публично: https://kppdf-crm.ru/db/app/"
