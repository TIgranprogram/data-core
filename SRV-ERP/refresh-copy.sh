#!/usr/bin/env bash
# Обновить копию на Sportin из свежего бэкапа. Запуск с ПК, из корня репо:
#   bash SRV-ERP/refresh-copy.sh [--code]
#   без флага — только база и новые фото; --code — ещё код из HEAD и сборка backend.
# Копия только для просмотра и проверки: всё, что в ней изменено, перезапишется при следующем обновлении.
# Прод и VM не трогает. Фото на Sportin не удаляются. Цели копий вне дома на Sportin выключаются.
set -euo pipefail
CODE=0; [[ "${1:-}" == "--code" ]] && CODE=1
KEY="${KEY:-$HOME/.ssh/erp_server}"; HOST="${HOST:-erpadmin@sportin.netcraze.pro}"
BACKUPS="${BACKUPS:-/d/datacore-backups}"
SSH=(ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=30 "$HOST")

cd "$(git rev-parse --show-toplevel)"
[[ "$("${SSH[@]}" hostname)" == "srv-erp" ]] || { echo "СТОП: это не сервер srv-erp"; exit 2; }
TGZ="$(ls -t "$BACKUPS"/datacore-*.tgz | head -1)"; STAMP="$(basename "$TGZ" .tgz)"; STAMP="${STAMP#datacore-}"
gzip -t "$TGZ" || { echo "СТОП: архив бэкапа повреждён: $TGZ"; exit 2; }
echo "== Бэкап: $(basename "$TGZ")"

echo "== Загрузка бэкапа"
scp -q -i "$KEY" "$TGZ" "$HOST:/var/lib/datacore/backups/incoming.tgz"

if [[ $CODE == 1 ]]; then
  echo "== Загрузка кода $(git log --oneline -1 | cut -c1-60)"
  git -c core.autocrlf=false archive --format=tar.gz HEAD backend docker-compose.prod.yml deploy | "${SSH[@]}" 'cat > /var/lib/datacore/backups/code.tgz'
fi

"${SSH[@]}" "CODE=$CODE STAMP=$STAMP bash -s" <<'REMOTE'
set -euo pipefail
cd /opt/data-core
set -a; . ./.env; set +a
B=/var/lib/datacore/backups; W=$B/work; rm -rf "$W"; mkdir -p "$W"
tar -xzf "$B/incoming.tgz" -C "$W"
M="$W/mongo-$STAMP/datacore"; U="$W/uploads-$STAMP"
[[ -f "$M/users.bson" ]] || { echo "СТОП: в бэкапе нет users.bson"; exit 2; }

echo "== Страховка: дамп текущей копии"
docker exec datacore-mongo sh -c 'rm -rf /tmp/before && mongodump --quiet -u "$0" -p "$1" --authenticationDatabase admin --db datacore -o /tmp/before' "$MONGO_ROOT_USER" "$MONGO_ROOT_PASSWORD"
rm -rf "$B/before-refresh"; docker cp datacore-mongo:/tmp/before "$B/before-refresh" >/dev/null

if [[ $CODE == 1 ]]; then
  echo "== Замена кода"
  rm -rf "$W/code"; mkdir -p "$W/code"; tar -xzf "$B/code.tgz" -C "$W/code"
  S=$(date +%Y%m%d%H%M)
  mkdir -p prev; mv backend "prev/backend.$S"; mv deploy "prev/deploy.$S"; cp docker-compose.prod.yml "prev/compose.$S"
  cp -a "$W/code/backend" "$W/code/deploy" .; cp "$W/code/docker-compose.prod.yml" .
  grep -q '^HTTP_STAND=' .env || echo 'HTTP_STAND=1' >> .env
  docker compose -f docker-compose.prod.yml build backend 2>&1 | tail -2
  ls -dt prev/backend.* | tail -n +3 | xargs -r rm -rf
  ls -dt prev/deploy.* | tail -n +3 | xargs -r rm -rf
fi

echo "== Остановка backend, замена базы"
docker stop datacore-backend >/dev/null
docker exec datacore-mongo rm -rf /tmp/restore
docker cp "$M" datacore-mongo:/tmp/restore >/dev/null
docker exec datacore-mongo sh -c 'mongorestore --quiet -u "$0" -p "$1" --authenticationDatabase admin --drop --db datacore /tmp/restore' "$MONGO_ROOT_USER" "$MONGO_ROOT_PASSWORD"
docker exec datacore-mongo sh -c 'mongo --quiet -u "$0" -p "$1" --authenticationDatabase admin datacore --eval "var r=db.backuptargets.updateMany({_id:{\$ne:\"settings\"}},{\$set:{enabled:false}}); print(\"целей копий выключено: \"+r.matchedCount)"' "$MONGO_ROOT_USER" "$MONGO_ROOT_PASSWORD"
docker exec datacore-mongo rm -rf /tmp/restore /tmp/before

echo "== Фото: только новые"
cp -a --update=none "$U/." /var/lib/datacore/uploads/
echo "файлов фото: $(ls /var/lib/datacore/uploads | wc -l)"

echo "== Запуск backend"
if [[ $CODE == 1 ]]; then docker compose -f docker-compose.prod.yml up -d --no-deps backend 2>&1 | tail -1; else docker start datacore-backend >/dev/null; fi
for i in $(seq 1 60); do
  [[ "$(curl -s -m 3 -o /dev/null -w '%{http_code}' http://localhost:3001/api/health/ready)" == "200" ]] && { echo "health 200"; break; }
  sleep 3; [[ $i == 60 ]] && { echo "СТОП: backend не поднялся"; docker logs --tail 15 datacore-backend; exit 1; }
done
rm -rf "$W" "$B/incoming.tgz" "$B/code.tgz"
REMOTE
echo "== Готово: http://31.222.224.247:8080/app/"
