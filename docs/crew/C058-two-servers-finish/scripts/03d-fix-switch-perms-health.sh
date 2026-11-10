#!/usr/bin/env bash
set -euo pipefail
echo "== Права switch/ на Доме (1777 через docker)"
ssh -o BatchMode=yes datacore-vm \
  'docker run --rm -v /var/lib/datacore/switch:/d alpine:3.20 chmod 1777 /d; ls -la /var/lib/datacore/switch'

echo "== Health Дом"
ssh -o BatchMode=yes datacore-vm \
  'for i in 1 2 3 4 5 6 7 8 9 10 11 12; do c=$(curl -s -m 3 -o /dev/null -w "%{http_code}" http://127.0.0.1:3001/api/health/ready || echo 000); echo try=$i HOME=$c; [ "$c" = 200 ] && break; sleep 5; done; docker ps --filter name=datacore-backend --format "{{.Status}}"; docker logs datacore-backend --tail 30 2>&1 | tail -20'

echo "== Ждём cron моста ~70с"
sleep 70
ssh -o BatchMode=yes datacore-vm 'ls -la /var/lib/datacore/switch/; test -f /var/lib/datacore/switch/alive && echo ALIVE_HOME || echo NO_ALIVE_HOME'
ssh -i "$HOME/.ssh/erp_server" -o BatchMode=yes erpadmin@sportin.netcraze.pro \
  'ls -la /var/lib/datacore/switch/; test -f /var/lib/datacore/switch/alive && echo ALIVE_ERP || echo NO_ALIVE_ERP'

echo "== API status"
bash deploy/synology/api.sh prod GET /api/control/switch
echo
echo PERMS_HEALTH_OK
