#!/usr/bin/env bash
# C058: полный прогон после 00:30. Лог: tools/logs/c058-run.log
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
DIR=docs/crew/C058-two-servers-finish/scripts
LOG=tools/logs/c058-run-$(date +%Y%m%dT%H%M%S).log
mkdir -p tools/logs
exec > >(tee -a "$LOG") 2>&1
echo "== C058 run start $(date -Is) log=$LOG"

bash "$DIR/01-backup-vm.sh"
bash "$DIR/02-refresh-code.sh"
bash "$DIR/03-enable-switch.sh"

echo "== Restart backends"
ssh -o BatchMode=yes datacore-vm 'cd /opt/data-core && docker restart datacore-backend && sleep 8 && curl -s -m 10 -o /dev/null -w "HOME_HEALTH=%{http_code}\n" http://127.0.0.1:3001/api/health/ready'
ssh -i "$HOME/.ssh/erp_server" -o BatchMode=yes erpadmin@sportin.netcraze.pro \
  'cd /opt/data-core && docker restart datacore-backend && sleep 8 && curl -s -m 10 -o /dev/null -w "ERP_HEALTH=%{http_code}\n" http://127.0.0.1:3001/api/health/ready'

bash "$DIR/04-peer-url-and-a4.sh"

echo "== Restart home after HA_PEER_URL"
ssh -o BatchMode=yes datacore-vm 'docker restart datacore-backend && sleep 8 && curl -s -m 10 -o /dev/null -w "HOME_HEALTH2=%{http_code}\n" http://127.0.0.1:3001/api/health/ready'

bash "$DIR/05-verify-switch.sh"

echo "== Kick refresh once"
printf '{"confirm":true}\n' > docs/crew/C058-two-servers-finish/tmp/confirm-start.json
mkdir -p docs/crew/C058-two-servers-finish/tmp
printf '{"confirm":true}\n' > docs/crew/C058-two-servers-finish/tmp/confirm-start.json
bash deploy/synology/api.sh prod POST /api/control/switch/refresh docs/crew/C058-two-servers-finish/tmp/confirm-start.json || true

echo "== Wait first auto/manual refresh settle (up to 20 min)"
for i in $(seq 1 40); do
  js=$(bash deploy/synology/api.sh prod GET /api/control/switch || echo '{}')
  echo "$js" | head -c 500; echo
  age=$(printf '%s' "$js" | sed -n 's/.*"copyAgeMin":\([0-9.]*\).*/\1/p' | head -1)
  alive=$(printf '%s' "$js" | sed -n 's/.*"alive":\([a-z]*\).*/\1/p' | head -1)
  en=$(printf '%s' "$js" | sed -n 's/.*"enabled":\([a-z]*\).*/\1/p' | head -1)
  echo "tick=$i enabled=$en alive=$alive copyAgeMin=$age"
  if [[ "$en" == "true" && "$alive" == "true" && -n "$age" ]] && awk "BEGIN{exit !($age < 20)}"; then
    echo REFRESH_FRESH_OK; break
  fi
  sleep 30
done

echo "== Schedule note: A7 at 02:00 via wait-until-0200 + 06-a7-drill"
echo RUN_PHASE1_OK log=$LOG
