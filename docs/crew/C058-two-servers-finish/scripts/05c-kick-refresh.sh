#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
mkdir -p docs/crew/C058-two-servers-finish/tmp
CONF="$(pwd)/docs/crew/C058-two-servers-finish/tmp/confirm-start.json"
printf '{"confirm":true}\n' > "$CONF"
echo "== POST refresh"
bash deploy/synology/api.sh prod POST /api/control/switch/refresh "$CONF"
echo
for i in $(seq 1 80); do
  js=$(bash deploy/synology/api.sh prod GET /api/control/switch || echo '{}')
  echo "[$i] $js" | head -c 900; echo
  if echo "$js" | grep -qE '"job":null|"state":"done"|"state":"failed"'; then
    echo DONE_OR_IDLE
    break
  fi
  sleep 10
done
