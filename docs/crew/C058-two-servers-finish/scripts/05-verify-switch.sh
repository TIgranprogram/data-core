#!/usr/bin/env bash
# Проверка после enable/restart. Без записи.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
echo "== Дом /api/control/switch"
bash deploy/synology/api.sh prod GET /api/control/switch | tee /tmp/c058-home-switch.json
echo
echo "== Sportin ping"
curl -s -m 10 http://127.0.0.1:4203/api/control/switch/ping 2>/dev/null || \
  curl -s -m 10 "http://31.222.224.247:8080/api/control/switch/ping" || true
echo
echo "== bridge files"
ssh -o BatchMode=yes datacore-vm 'ls -la /var/lib/datacore/switch/; crontab -l | grep switch-watch || echo NO_CRON'
ssh -i "$HOME/.ssh/erp_server" -o BatchMode=yes erpadmin@sportin.netcraze.pro \
  'ls -la /var/lib/datacore/switch/; crontab -l | grep switch-watch || echo NO_CRON; printenv HA_SELF 2>/dev/null; docker exec datacore-backend printenv HA_SELF || echo HA_SELF_ABSENT'
echo VERIFY_DONE
