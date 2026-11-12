#!/usr/bin/env bash
# C094 (2026-11-12): признаки видов изделия (guards, bin, bars, landing) в справочнике «Функциональные элементы».
#   bash deploy/synology/c094-traits.sh            - только план, ничего не пишет
#   bash deploy/synology/c094-traits.sh --apply    - копия базы на сервере, затем запись
# Скрипт backend/scripts/c094-traits.js идёт в контейнер через remote-access/run-script.sh (на сервере не остаётся).
# Признаки только добавляются к стоящим. Выданные паспорта не меняются. Запускать до c094-texts.
set -uo pipefail
cd "$(dirname "$0")/../.."
if [ "${1:-}" = "--apply" ]; then
  echo "== План"; bash remote-access/run-script.sh c094-traits || exit 1
  echo "== Запись"; bash remote-access/run-script.sh c094-traits --apply
else
  bash remote-access/run-script.sh c094-traits
fi
