#!/usr/bin/env bash
# ИЗ-21 / C093 (2026-11-12): 37 изделий — перенос в свои группы и правка ручной категории паспорта.
#   bash deploy/synology/iz21-regroup.sh            - только план, ничего не пишет
#   bash deploy/synology/iz21-regroup.sh --apply    - копия базы на сервере, затем запись
# Скрипт backend/scripts/iz21-regroup.js идёт в контейнер через remote-access/run-script.sh (на сервере не остаётся).
# Перед записью сверяется «было»: если изделие изменили, запись стоп. Откат (старые значения) печатается в вывод.
# Качели 3205, 3206, 3208, 3209, 3213, 3217 в плане нет. Удаления нет. Выданные паспорта не меняются.
set -uo pipefail
cd "$(dirname "$0")/../.."
if [ "${1:-}" = "--apply" ]; then
  echo "== План"; bash remote-access/run-script.sh iz21-regroup || exit 1
  echo "== Запись"; bash remote-access/run-script.sh iz21-regroup --apply
else
  bash remote-access/run-script.sh iz21-regroup
fi
