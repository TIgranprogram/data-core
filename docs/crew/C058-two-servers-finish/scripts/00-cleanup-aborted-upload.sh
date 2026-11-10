#!/usr/bin/env bash
# Снять оборванный scp; база/код Sportin не трогались.
set -euo pipefail
ssh -i "$HOME/.ssh/erp_server" -o BatchMode=yes -o ConnectTimeout=15 erpadmin@sportin.netcraze.pro \
  'rm -f /var/lib/datacore/backups/incoming.tgz /var/lib/datacore/backups/code.tgz; curl -s -m 5 -o /dev/null -w "HEALTH=%{http_code}\n" http://127.0.0.1:3001/api/health/ready; hostname'
