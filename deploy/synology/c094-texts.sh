#!/usr/bin/env bash
# C094 (2026-11-12): условия применимости пунктов текстов паспорта: новая версия «Для всех» (v3) и BLG / WRK / DIO.
#   bash deploy/synology/c094-texts.sh            - только план, ничего не пишет
#   bash deploy/synology/c094-texts.sh --apply    - копия базы на сервере, затем запись
# Скрипт backend/scripts/c094-texts-v3.js идёт в контейнер через remote-access/run-script.sh (на сервере не остаётся).
# Меняются только условия when; тексты пунктов и выданные паспорта не меняются. Запускать после c094-traits (без признаков видов скрипт останавливается).
set -uo pipefail
cd "$(dirname "$0")/../.."
if [ "${1:-}" = "--apply" ]; then
  echo "== План"; bash remote-access/run-script.sh c094-texts-v3 || exit 1
  echo "== Запись"; bash remote-access/run-script.sh c094-texts-v3 --apply
else
  bash remote-access/run-script.sh c094-texts-v3
fi
