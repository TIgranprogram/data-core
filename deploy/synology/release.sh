#!/usr/bin/env bash
# Выкладка data-core на VM вручную по ssh (когда нет python/deploy.py) — по шагам skill `datacore-deploy`.
# Запуск из корня репо в Git Bash:   bash deploy/synology/release.sh [--data] [--drop-archive]
#   без флагов — только новая версия backend (бэкап → архив HEAD → замена backend/ deploy/ → build → up → проверка);
#   --data          — плюс загрузка Excel-заказов с фото и привязка заказов «Спортсет» (повторно безопасно, ничего не задваивает);
#   --drop-archive  — после бэкапа: архивные таблицы прежнего приложения (app_supply_*, app_warehouse_*) выгружаются
#                     в /var/lib/datacore/backups/archive-<дата>/ и удаляются (разово, TASKS 7.2).
# Mongo-контейнер и CRM kppdf не трогаются: пересобирается и перезапускается только datacore-backend.
set -euo pipefail
VM="${VM:-tiit@192.168.1.52}"
KEY="${KEY:-$HOME/.ssh/kppdf80-vm}"
ORDERS_DIR="${ORDERS_DIR:-для анализа/заказы}"
SSH=(ssh -i "$KEY" -o BatchMode=yes "$VM")
DATA=0; DROP=0
for a in "$@"; do [[ "$a" == "--data" ]] && DATA=1; [[ "$a" == "--drop-archive" ]] && DROP=1; done

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
  scp -i "$KEY" -o BatchMode=yes backend/scripts/import-orders-xlsx.js backend/scripts/add-our-company.js "$VM:/tmp/dc-scripts/"
  scp -i "$KEY" -o BatchMode=yes "$ORDERS_DIR"/*.xlsx "$VM:/tmp/dc-orders/"
  "${SSH[@]}" 'set -e; docker exec datacore-backend mkdir -p /app/scripts /tmp/orders
    docker cp /tmp/dc-scripts/. datacore-backend:/app/scripts/; docker cp /tmp/dc-orders/. datacore-backend:/tmp/orders/
    echo "-- наша компания «Спортсет» и её заказы"; docker exec -w /app datacore-backend node scripts/add-our-company.js --name Спортсет --key СПОРТСЕТ --apply | tail -3
    echo "-- заказы из Excel (+фото)"; docker exec -w /app datacore-backend node scripts/import-orders-xlsx.js /tmp/orders --photos --apply | tail -6
    docker exec datacore-backend rm -rf /tmp/orders; rm -rf /tmp/dc-orders /tmp/dc-scripts'
fi

if [[ $DROP == 1 ]]; then
  echo "== 6. Архивные таблицы: выгрузка в файлы и удаление"
  scp -i "$KEY" -o BatchMode=yes backend/scripts/drop-archive-collections.js "$VM:/tmp/drop-archive-collections.js"
  "${SSH[@]}" 'set -e; D=/var/lib/datacore/backups/archive-$(date +%Y-%m-%d); docker exec datacore-backend mkdir -p /app/scripts
    docker cp /tmp/drop-archive-collections.js datacore-backend:/app/scripts/
    docker exec -w /app -e OUT_DIR=/tmp/archive-export datacore-backend node scripts/drop-archive-collections.js --apply
    mkdir -p $D; docker cp datacore-backend:/tmp/archive-export/. $D/; docker exec datacore-backend rm -rf /tmp/archive-export; ls -la $D | tail -6; rm -f /tmp/drop-archive-collections.js'
fi
echo "== Готово. Публично: https://kppdf-crm.ru/db/app/"
