#!/usr/bin/env bash
# C058 A7: учебное переключение Дом→Sportin→Дом.
# Если сайт не 200 после шага — сразу вернуть на Дом (start с нового главного / emergency).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
LOG=tools/logs/c058-a7-$(date +%Y%m%dT%H%M%S).log
mkdir -p tools/logs docs/crew/C058-two-servers-finish/tmp
CONFIRM="$(pwd)/docs/crew/C058-two-servers-finish/tmp/confirm-start.json"
printf '{"confirm":true}\n' > "$CONFIRM"

say() { printf '%s\n' "$*" | tee -a "$LOG"; }
api() { bash deploy/synology/api.sh prod "$@"; }

site_ok() {
  local code
  code=$(curl -s -m 15 -o /dev/null -w '%{http_code}' https://kppdf-crm.ru/db/api/health/ready || echo 000)
  [[ "$code" == "200" ]]
}

wait_job_done() {
  local deadline=$((SECONDS + 600)) js state
  while (( SECONDS < deadline )); do
    js=$(api GET /api/control/switch 2>/dev/null || echo '{}')
    say "$js"
    if printf '%s' "$js" | grep -q '"job":null'; then printf '%s\n' "$js"; return 0; fi
    state=$(printf '%s' "$js" | sed -n 's/.*"state":"\([^"]*\)".*/\1/p' | head -1)
    if [[ "$state" == "done" || "$state" == "failed" ]]; then printf '%s\n' "$js"; return 0; fi
    sleep 5
  done
  say "TIMEOUT job"; return 1
}

revert_home() {
  say "== АВАРИЯ: возвращаем Дом"
  # если домен уже на Sportin — POST start с confirm снова переключит обратно на Дом
  api POST /api/control/switch/start "$CONFIRM" || true
  sleep 20
  local n=0
  while (( n < 60 )); do
    site_ok && { say REVERT_SITE_OK; return 0; }
    sleep 5; n=$((n+1))
  done
  say REVERT_SITE_FAIL; return 1
}

say "== A7 start $(date -Is)"
BEFORE=$(api GET /api/control/switch || true)
say "$BEFORE"
site_ok || { say "СТОП: сайт не 200 до A7"; exit 2; }

say "== Дом → Sportin"
T0=$(date +%s)
api POST /api/control/switch/start "$CONFIRM"
wait_job_done
T1=$(date +%s)
say "TIME_HOME_TO_OFFICE=$((T1-T0))s"
if ! site_ok; then say SITE_DOWN_AFTER_FIRST; revert_home; exit 3; fi
say SITE_OK_ON_OFFICE

say "== пауза 90с"
sleep 90

say "== Sportin → Дом"
T2=$(date +%s)
api POST /api/control/switch/start "$CONFIRM"
wait_job_done
T3=$(date +%s)
say "TIME_OFFICE_TO_HOME=$((T3-T2))s"
if ! site_ok; then say SITE_DOWN_AFTER_RETURN; revert_home; exit 4; fi
say SITE_OK_ON_HOME
AFTER=$(api GET /api/control/switch || true)
say "$AFTER"
say "A7_OK log=$LOG"
