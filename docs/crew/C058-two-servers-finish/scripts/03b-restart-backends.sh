#!/usr/bin/env bash
set -euo pipefail
echo "== Restart home"
ssh -o BatchMode=yes datacore-vm 'docker restart datacore-backend; sleep 12; curl -s -m 10 -o /dev/null -w "HOME=%{http_code}\n" http://127.0.0.1:3001/api/health/ready; echo -n HA_SELF=; docker exec datacore-backend printenv HA_SELF; echo; crontab -l | grep switch-watch || echo NO_CRON_HOME; ls -la /var/lib/datacore/switch/'
echo "== Restart Sportin"
ssh -i "$HOME/.ssh/erp_server" -o BatchMode=yes erpadmin@sportin.netcraze.pro \
  'docker restart datacore-backend; sleep 14; curl -s -m 10 -o /dev/null -w "ERP=%{http_code}\n" http://127.0.0.1:3001/api/health/ready; echo -n HA_SELF=; docker exec datacore-backend printenv HA_SELF; echo; crontab -l | grep switch-watch || echo NO_CRON_ERP; ls -la /var/lib/datacore/switch/'
echo RESTART_OK
