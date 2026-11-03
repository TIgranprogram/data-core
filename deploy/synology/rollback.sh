#!/usr/bin/env bash
# Откат только приложения; Mongo, uploads и секреты не изменяются.
# На VM: bash deploy/synology/rollback.sh [backend.prev-<TS>] [--screens-only]
set -euo pipefail
cd "${DC_ROLLBACK_ROOT:-$(dirname "$0")/../..}"
PREV=""; SCREENS=0
for a in "$@"; do [[ "$a" == "--screens-only" ]] && SCREENS=1 || PREV="$a"; done
if [[ -z "$PREV" ]]; then
  for p in $(find . -maxdepth 1 -type d -name 'backend.prev-*' -printf '%f\n' | sort -r); do
    [[ -f ".rollback-${p#backend.prev-}" ]] && { PREV="$p"; break; }
  done
fi
[[ "$PREV" =~ ^backend\.prev-[0-9]{14}$ && -d "$PREV" ]] || { echo "ОТКАТ: СТОП — проверенная копия приложения не найдена"; exit 1; }
TS="${PREV#backend.prev-}"
META=".rollback-$TS"
IMAGE=""; RELEASE=""; MODE=""
if [[ -f "$META" ]]; then
  IMAGE="$(sed -n 's/^image=//p' "$META")"
  RELEASE="$(sed -n 's/^release=//p' "$META")"
  MODE="$(sed -n 's/^mode=//p' "$META")"
fi
[[ "$MODE" == fast ]] && SCREENS=1
rm -f .release-commit
if [[ $SCREENS == 1 ]]; then
  [[ -d "$PREV/pwa" && -d "$PREV/admin" ]] || { echo "ОТКАТ: СТОП — копия экранов неполна"; exit 1; }
  bash deploy/synology/sync-dir.sh "$PREV/pwa" backend/pwa --skip version.json
  bash deploy/synology/sync-dir.sh "$PREV/admin" backend/admin
  [[ ! -f "$PREV/pwa/version.json" ]] || cp -p "$PREV/pwa/version.json" backend/pwa/version.json
else
  # Образ фиксируется по ID до сборки; mutable :prev — только совместимость со старыми копиями.
  if [[ -z "$IMAGE" ]]; then IMAGE="$(docker image inspect -f '{{.Id}}' datacore-backend:prev)"; fi
  [[ "$IMAGE" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "ОТКАТ: СТОП — прежний image ID не подтверждён"; exit 1; }
  docker image inspect "$IMAGE" >/dev/null
  [[ -d "deploy.prev-$TS" && -f "docker-compose.prod.yml.prev-$TS" ]] || { echo "ОТКАТ: СТОП — копия кода/compose неполна"; exit 1; }
  NAME="$(docker inspect -f '{{.Config.Image}}' datacore-backend)"
  docker tag "$IMAGE" "$NAME"
  # Старый скрипт продолжает выполняться из своего открытого файла после перемещения deploy.
  [[ ! -e "backend.failed-$TS" && ! -e "deploy.failed-$TS" ]] || { echo "ОТКАТ: СТОП — каталог неудачного выпуска уже существует"; exit 1; }
  [[ ! -e backend ]] || mv backend "backend.failed-$TS"
  mv "$PREV" backend
  [[ ! -e deploy ]] || mv deploy "deploy.failed-$TS"
  mv "deploy.prev-$TS" deploy
  cp -p "docker-compose.prod.yml.prev-$TS" docker-compose.prod.yml
  docker compose -f docker-compose.prod.yml up -d --no-deps --no-build --pull never backend
fi
s=000
for i in $(seq 1 30); do
  s="$(curl --max-time 10 -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/api/health/ready || true)"
  [[ "$s" == 200 ]] && break; sleep 3
done
app="$(curl --max-time 10 -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/app/ || true)"
if [[ "$s" == 200 && "$app" == 200 ]]; then
  [[ ! "$RELEASE" =~ ^[0-9a-f]{40}$ ]] || printf '%s\n' "$RELEASE" > .release-commit
  echo "ОТКАТ: ОК — прежние код и образ возвращены; health 200; приложение 200"
else
  echo "ОТКАТ: СБОЙ — health $s; приложение $app"; exit 1
fi
