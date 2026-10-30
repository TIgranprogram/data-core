#!/usr/bin/env bash
# Разовый скрипт backend/scripts/<имя>.js на проде: идёт в контейнер через stdin, на сервере не остаётся.
#   bash remote-access/run-script.sh <имя>           - план, ничего не пишет
#   bash remote-access/run-script.sh <имя> --apply   - бэкап на сервере, затем запись (нет бэкапа - стоп)
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
NAME="${1:?имя скрипта}"; MODE="${2:-}"
[ -f "backend/scripts/$NAME.js" ] || { echo "нет backend/scripts/$NAME.js"; exit 2; }
[ -z "$MODE" ] || [ "$MODE" = "--apply" ] || { echo "usage: run-script.sh <имя> [--apply]"; exit 2; }
SSH=(ssh -i "$HOME/.ssh/datacore_work" -o BatchMode=yes datacore-vm)
if [ "$MODE" = "--apply" ]; then
  echo "== Бэкап"
  "${SSH[@]}" 'cd /opt/data-core && if bash deploy/synology/backup.sh >/tmp/dc-backup.log 2>&1; then tail -1 /tmp/dc-backup.log; else echo "СТОП: бэкап не прошёл"; tail -5 /tmp/dc-backup.log; exit 1; fi'
fi
"${SSH[@]}" "docker exec -i -w /app datacore-backend node - $MODE" < "backend/scripts/$NAME.js"
