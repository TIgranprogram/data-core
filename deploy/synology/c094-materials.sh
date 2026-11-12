#!/usr/bin/env bash
# C094 (2026-11-12): материал изделия (passportDefaults.materialIds) для условий «металл / дерево» в текстах паспорта.
#   bash deploy/synology/c094-materials.sh            - только план, ничего не пишет
#   bash deploy/synology/c094-materials.sh --apply    - копия базы на сервере, затем запись
# Скрипт backend/scripts/c094-materials.js идёт в контейнер через remote-access/run-script.sh (на сервере не остаётся).
# Пишется только в пустое поле, только ясные случаи (по таблице материалов, по явному «стальн…»). Неясные остаются пустыми. Выданные паспорта не меняются.
set -uo pipefail
cd "$(dirname "$0")/../.."
if [ "${1:-}" = "--apply" ]; then
  echo "== План"; bash remote-access/run-script.sh c094-materials || exit 1
  echo "== Запись"; bash remote-access/run-script.sh c094-materials --apply
else
  bash remote-access/run-script.sh c094-materials
fi
