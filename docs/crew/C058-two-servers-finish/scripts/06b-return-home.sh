#!/usr/bin/env bash
# Вернуть Дом главным (сейчас main=office после сбоя сценария A7).
set -eu
cd "$(git rev-parse --show-toplevel)"
CONF="$(pwd)/docs/crew/C058-two-servers-finish/tmp/confirm-start.json"
printf '{"confirm":true}\n' > "$CONF"
echo "== status before"
bash deploy/synology/api.sh prod GET /api/control/switch
echo
echo "== start office->home"
bash deploy/synology/api.sh prod POST /api/control/switch/start "$CONF"
echo
for i in $(seq 1 90); do
  js=$(bash deploy/synology/api.sh prod GET /api/control/switch || echo '{}')
  echo "[$i] $js" | sed 's/.\{900\}.*/&…/'
  self=$(echo "$js" | sed -n 's/.*"self":"\([^"]*\)".*/\1/p' | head -1)
  role=$(echo "$js" | sed -n 's/.*"role":"\([^"]*\)".*/\1/p' | head -1)
  state=$(echo "$js" | sed -n 's/.*"state":"\([^"]*\)".*/\1/p' | head -1)
  if [[ "$self" == "home" && "$role" == "main" && ( -z "$state" || "$state" == "done" || $(echo "$js" | grep -c '"job":null') -gt 0 ) ]]; then
    echo RETURNED_HOME
    break
  fi
  if [[ "$state" == "failed" ]]; then echo SWITCH_FAILED; break; fi
  sleep 10
done
code=$(curl -s -m 15 -o /dev/null -w '%{http_code}' https://kppdf-crm.ru/db/api/health/ready || echo 000)
echo SITE=$code
bash deploy/synology/api.sh prod GET /api/control/switch
echo
# CRM могла остаться выключенной на Доме — поднять обратно
ssh -o BatchMode=yes datacore-vm 'docker start kppdf-backend >/dev/null 2>&1 || true; docker ps --filter name=kppdf-backend --format "{{.Names}} {{.Status}}"'
echo RETURN_DONE
