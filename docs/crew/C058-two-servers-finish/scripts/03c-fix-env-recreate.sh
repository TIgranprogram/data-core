#!/usr/bin/env bash
# HA_SELF в .env есть; docker restart не подхватывает — compose up -d.
# bridge.env на Доме — через docker (без sudo).
set -euo pipefail

VPS_TARGET="$(ssh -o BatchMode=yes datacore-vm 'crontab -l 2>/dev/null | grep -o "VPS_TARGET=[^ ]*" | head -1 | cut -d= -f2')"
ERP_HOST="${ERP_HOST:-erpadmin@sportin.netcraze.pro}"
ERP_HOSTNAME="$(ssh -i "$HOME/.ssh/erp_server" -o BatchMode=yes "$ERP_HOST" hostname)"

echo "== bridge.env на Доме через docker"
# содержимое без раскрытия ключей в локальный лог сверх меры: пишем на VM
ssh -o BatchMode=yes datacore-vm "bash -s" <<EOF
set -euo pipefail
d=/var/lib/datacore/switch
if [[ -f "\$d/bridge.env" ]]; then
  echo BRIDGE_ENV_EXISTS
else
  docker run --rm -v "\$d:/d" alpine:3.20 sh -c "cat > /d/bridge.env <<'E2'
HA_SELF=home
HA_PEER_SSH=$ERP_HOST
HA_PEER_HOST=$ERP_HOSTNAME
HA_PEER_KEY=\\\$HOME/.ssh/dc_transfer
HA_VPS_SSH=$VPS_TARGET
HA_VPS_KEY=\\\$HOME/.ssh/dc_switch
E2
chmod 644 /d/bridge.env"
  echo BRIDGE_ENV_CREATED
fi
ls -la "\$d"
EOF

echo "== compose up -d home"
ssh -o BatchMode=yes datacore-vm 'cd /opt/data-core && docker compose -f docker-compose.prod.yml up -d backend && for i in 1 2 3 4 5 6 7 8 9 10; do code=$(curl -s -m 3 -o /dev/null -w "%{http_code}" http://127.0.0.1:3001/api/health/ready || echo 000); echo try=\$i HOME=\$code; [[ \$code == 200 ]] && break; sleep 3; done; echo -n HA_SELF=; docker exec datacore-backend printenv HA_SELF; echo; ls -la /var/lib/datacore/switch/'

echo "== compose up -d Sportin"
ssh -i "$HOME/.ssh/erp_server" -o BatchMode=yes erpadmin@sportin.netcraze.pro \
  'cd /opt/data-core && docker compose -f docker-compose.prod.yml up -d backend && for i in 1 2 3 4 5 6 7 8 9 10; do code=$(curl -s -m 3 -o /dev/null -w "%{http_code}" http://127.0.0.1:3001/api/health/ready || echo 000); echo try=$i ERP=$code; [[ $code == 200 ]] && break; sleep 3; done; echo -n HA_SELF=; docker exec datacore-backend printenv HA_SELF; echo'

echo RECREATE_OK
