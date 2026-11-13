#!/usr/bin/env bash
# C112 А2 (2026-11-14): изделия с убранным вариантом текста паспорта — замена на живой вариант с тем же названием.
#   bash deploy/synology/c112-a2-gone-choices.sh            - только план, ничего не пишет
#   bash deploy/synology/c112-a2-gone-choices.sh --apply    - копия базы на сервере, затем запись
# Пишет только products.passportDefaults.textChoices.<корень>, при совпадении старого значения. Неоднозначные — список «вручную».
set -uo pipefail
cd "$(dirname "$0")/../.."
if [ "${1:-}" = "--apply" ]; then
  echo "== План"; bash remote-access/run-script.sh c112-a2-gone-choices || exit 1
  echo "== Запись"; bash remote-access/run-script.sh c112-a2-gone-choices --apply
else
  bash remote-access/run-script.sh c112-a2-gone-choices
fi
