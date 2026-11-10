#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
mkdir -p docs/crew/C058-two-servers-finish/tmp
printf '{"confirm":true}\n' > docs/crew/C058-two-servers-finish/tmp/confirm-start.json

echo "== Ждём Дом health"
for i in $(seq 1 30); do
  c=$(ssh -o BatchMode=yes datacore-vm 'curl -s -m 3 -o /dev/null -w "%{http_code}" http://127.0.0.1:3001/api/health/ready' || echo 000)
  echo try=$i HOME=$c
  [[ "$c" == 200 ]] && break
  sleep 3
done
pub=$(curl -s -m 10 -o /dev/null -w '%{http_code}' https://kppdf-crm.ru/db/api/health/ready || echo 000)
echo PUBLIC_DB=$pub

echo "== Status"
js=$(bash deploy/synology/api.sh prod GET /api/control/switch)
echo "$js"
echo

echo "== Kick refresh"
bash deploy/synology/api.sh prod POST /api/control/switch/refresh docs/crew/C058-two-servers-finish/tmp/confirm-start.json || true
echo

echo "== Ждём job refresh (до 15 мин)"
for i in $(seq 1 60); do
  js=$(bash deploy/synology/api.sh prod GET /api/control/switch || echo '{}')
  echo "$js" | head -c 700; echo
  if echo "$js" | grep -q '"job":null'; then
    age=$(echo "$js" | sed -n 's/.*"copyAgeMin":\([0-9.]*\).*/\1/p' | head -1)
    echo SETTLED copyAgeMin=$age
    break
  fi
  if echo "$js" | grep -q '"state":"failed"'; then
    echo REFRESH_FAILED
    break
  fi
  sleep 15
done
echo KICK_DONE
