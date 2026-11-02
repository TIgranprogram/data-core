#!/usr/bin/env bash
# Откат на прошлую версию. Запуск на VM: cd /opt/data-core && bash deploy/synology/rollback.sh [backend.prev-<TS>] [--screens-only]
#   без --screens-only — сервер: образ datacore-backend:prev (его тегирует release.sh перед сборкой) + экраны из указанной копии;
#   --screens-only     — только экраны (быстрая выкладка release.sh): обновить pwa/admin из копии, образ и контейнер не трогаем.
# Копию release.sh передаёт точным именем (по дате папок искать нельзя: mv/cp -a сохраняют старую mtime).
# Экраны примонтированы папками (docker-compose.prod.yml) — обновляем на месте (sync-dir.sh, без rsync), сами папки не переносим.
# Пометка /opt/data-core/.release-commit удаляется: следующая выкладка пойдёт полным путём.
# Mongo и kppdf не трогаются. Данные не откатываются: если новая версия успела их изменить, смотреть отдельно.
set -euo pipefail
cd "$(dirname "$0")/../.."
PREV=""; SCREENS=0
for a in "$@"; do [[ "$a" == "--screens-only" ]] && SCREENS=1 || PREV="$a"; done
rm -f .release-commit

screens_back() {
  [[ -n "$PREV" && -d "$PREV/pwa" ]] || { echo "экраны не возвращены: копия ${PREV:-не указана} не найдена"; return 1; }
  bash deploy/synology/sync-dir.sh "$PREV/pwa" backend/pwa --skip version.json
  [[ -f "$PREV/pwa/version.json" ]] && cp -p "$PREV/pwa/version.json" backend/pwa/version.json
  bash deploy/synology/sync-dir.sh "$PREV/admin" backend/admin
  echo "экраны возвращены из $PREV"
}

if [[ $SCREENS == 1 ]]; then screens_back; exit $?; fi

if ! docker image inspect datacore-backend:prev >/dev/null 2>&1; then echo "Прошлой версии нет: образ datacore-backend:prev не найден"; exit 1; fi
# полный путь: release.sh перенёс backend → $PREV, новый backend на месте — экраны возвращаем до перезапуска
if [[ -n "$PREV" ]]; then screens_back || true; fi
NAME="$(docker inspect -f '{{.Config.Image}}' datacore-backend)"
docker tag datacore-backend:prev "$NAME"
docker compose -f docker-compose.prod.yml up -d --no-deps --no-build backend
for i in $(seq 1 30); do s="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/api/health/ready)"; [ "$s" = 200 ] && break; sleep 3; done
echo "откат: /api/health/ready $s"
[ "$s" = 200 ]
