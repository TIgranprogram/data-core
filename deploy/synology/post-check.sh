#!/usr/bin/env bash
# Проверка после выкладки (RELEASE-GATE RG-9): ошибки с сайта (clienterrors) с момента выкладки — только чтение.
#   bash deploy/synology/post-check.sh [часы]
# Часы по умолчанию — с последнего тега release-* (если тегов нет — 2 ч). Запускает агент datacore-access через 1–2 ч после release.sh.
# Последняя строка: «ПОСЛЕ ВЫКЛАДКИ: чисто» или «ПОСЛЕ ВЫКЛАДКИ: N новых групп ошибок — в очередь первыми».
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
HOURS="${1:-}"
if [[ -z "$HOURS" ]]; then
  T="$(git for-each-ref --sort=-creatordate --count=1 --format='%(creatordate:unix)' 'refs/tags/release-*')"
  [[ -n "$T" ]] && HOURS=$(( ( $(date +%s) - T ) / 3600 + 1 )) || HOURS=2
  if (( HOURS > 720 )); then HOURS=720; fi
fi
if [[ ! "$HOURS" =~ ^[1-9][0-9]{0,2}$ ]] || (( HOURS > 720 )); then
  echo 'Укажите число часов от 1 до 720.' >&2
  exit 2
fi
if ! VER="$(curl -fsS --max-time 15 -H 'Cache-Control: no-cache' https://kppdf-crm.ru/db/app/version.json | node deploy/synology/client-errors-report.js version)"; then
  echo 'ПОСЛЕ ВЫКЛАДКИ: не удалось прочитать версию сайта'
  exit 1
fi
if ! DATA="$(bash deploy/synology/api.sh prod GET "/api/client-errors/top?hours=$HOURS&version=$VER")"; then
  echo 'ПОСЛЕ ВЫКЛАДКИ: журнал ошибок недоступен'
  exit 1
fi
node deploy/synology/client-errors-report.js post-check "$VER" "$HOURS" <<< "$DATA"
