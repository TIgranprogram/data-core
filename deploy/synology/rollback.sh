#!/usr/bin/env bash
# Откат на прошлую версию backend: образ datacore-backend:prev (его тегирует release.sh перед сборкой).
# Запуск на VM: cd /opt/data-core && bash deploy/synology/rollback.sh
# Mongo и kppdf не трогаются. Данные не откатываются: если новая версия успела их изменить, смотреть отдельно.
set -euo pipefail
cd "$(dirname "$0")/../.."
if ! docker image inspect datacore-backend:prev >/dev/null 2>&1; then echo "Прошлой версии нет: образ datacore-backend:prev не найден"; exit 1; fi
NAME="$(docker inspect -f '{{.Config.Image}}' datacore-backend)"
docker tag datacore-backend:prev "$NAME"
docker compose -f docker-compose.prod.yml up -d --no-deps --no-build backend
for i in $(seq 1 30); do s="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/api/health/ready)"; [ "$s" = 200 ] && break; sleep 3; done
echo "откат: /api/health/ready $s"
[ "$s" = 200 ]
