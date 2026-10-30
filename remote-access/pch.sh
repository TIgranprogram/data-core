#!/usr/bin/env bash
# ПЧ-1 и ПЧ-2 на проде: скрипты идут в контейнер через stdin, файлы на сервере не остаются.
#   bash remote-access/pch.sh           - план, ничего не пишет
#   bash remote-access/pch.sh --apply   - бэкап на сервере, затем запись (нет бэкапа - стоп)
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
MODE="${1:-}"
[ -z "$MODE" ] || [ "$MODE" = "--apply" ] || { echo "usage: pch.sh [--apply]"; exit 2; }
SSH=(ssh -i "$HOME/.ssh/datacore_work" -o BatchMode=yes datacore-vm)

if [ "$MODE" = "--apply" ]; then
  echo "== Бэкап"
  "${SSH[@]}" 'cd /opt/data-core && if bash deploy/synology/backup.sh >/tmp/dc-backup.log 2>&1; then tail -1 /tmp/dc-backup.log; else echo "СТОП: бэкап не прошёл"; tail -5 /tmp/dc-backup.log; exit 1; fi'
fi
for s in fix-passport-categories seed-passport-parts-ch2; do
  echo; echo "== $s"
  "${SSH[@]}" "docker exec -i -w /app datacore-backend node - $MODE" < "backend/scripts/$s.js"
done
