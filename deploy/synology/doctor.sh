#!/usr/bin/env bash
# Осмотр прода одной командой, только чтение: bash deploy/synology/doctor.sh
# Запускает агент datacore-access (вход — api.sh) или сессия с доступом к прод-API.
# Строки: ✓ норма · ⚠ посмотреть · ✗ чинить сейчас. Последняя строка — итог. Код выхода 1, если есть ✗.
# Шаг про кэш сборки идёт по ssh datacore-vm (с работы — через VPS); нет связи — ⚠, а не сбой.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
api() { bash deploy/synology/api.sh prod GET "$1" 2>/dev/null; }
HEALTH="$(curl -s -m 20 https://kppdf-crm.ru/db/api/health || true)"
VERSION="$(curl -s -m 20 https://kppdf-crm.ru/db/app/version.json || true)"
DISK="$(api /api/health/disk)"; OFFSITE="$(api /api/health/offsite)"; BACKUPS="$(api /api/health/backups)"
ERRORS="$(api '/api/client-errors/top?hours=24')"; INTEGRITY="$(api '/api/health/integrity?fresh=1')"; SLOW="$(api /api/health/slow)"
CACHE="$(ssh -o BatchMode=yes -o ConnectTimeout=10 datacore-vm "docker system df --format '{{.Type}}={{.Size}}'" 2>/dev/null | grep -i '^build' || true)"
DRILL="$(ssh -o BatchMode=yes -o ConnectTimeout=10 datacore-vm 'tail -1 /var/lib/datacore/backups/drill.log' 2>/dev/null || true)"
export HEALTH VERSION DISK OFFSITE BACKUPS ERRORS INTEGRITY SLOW CACHE DRILL
node deploy/synology/doctor-report.js
