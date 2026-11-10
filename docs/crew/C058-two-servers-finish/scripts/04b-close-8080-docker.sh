#!/usr/bin/env bash
# A4 без host-sudo: iptables через privileged docker; compose bind 127.0.0.1 на Sportin.
set -euo pipefail
ERP=(ssh -i "$HOME/.ssh/erp_server" -o BatchMode=yes -o ConnectTimeout=20 erpadmin@sportin.netcraze.pro)

echo "== Закрыть 0.0.0.0:3001 через privileged container"
"${ERP[@]}" 'bash -s' <<'EOF'
set -euo pipefail
# DOCKER-USER через net=host privileged
docker run --rm --privileged --network host alpine:3.20 sh -c '
  apk add --no-cache iptables >/dev/null
  if iptables -S DOCKER-USER 2>/dev/null | grep -q C058-A4; then
    echo FIREWALL_ALREADY
  else
    iptables -N DOCKER-USER 2>/dev/null || true
    iptables -I DOCKER-USER -p tcp --dport 3001 -s 127.0.0.1 -j ACCEPT -m comment --comment C058-A4
    iptables -I DOCKER-USER -p tcp --dport 3001 -i lo -j ACCEPT -m comment --comment C058-A4
    iptables -A DOCKER-USER -p tcp --dport 3001 -j DROP -m comment --comment C058-A4
    echo FIREWALL_APPLIED
  fi
  iptables -S DOCKER-USER | grep C058-A4 || true
'
curl -s -m 5 -o /dev/null -w "LOCAL=%{http_code}\n" http://127.0.0.1:3001/api/health/ready
EOF

echo "== Пересоздать backend с bind только localhost (patch ports)"
"${ERP[@]}" 'bash -s' <<'EOF'
set -euo pipefail
cd /opt/data-core
ts=$(date -u +%Y%m%dT%H%M%SZ)
cp -a docker-compose.prod.yml "/var/lib/datacore/backups/c058/compose-$ts.bak"
# идемпотентно: 3001:3000 → 127.0.0.1:3001:3000
if grep -q '"127.0.0.1:3001:3000"' docker-compose.prod.yml || grep -q '127.0.0.1:3001:3000' docker-compose.prod.yml; then
  echo BIND_ALREADY
else
  sed -i 's/"3001:3000"/"127.0.0.1:3001:3000"/' docker-compose.prod.yml
  grep -n '3001:3000' docker-compose.prod.yml || true
  echo BIND_PATCHED
fi
docker compose -f docker-compose.prod.yml up -d backend
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  c=$(curl -s -m 3 -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/api/health/ready || echo 000)
  echo try=$i LOCAL=$c
  [[ "$c" == 200 ]] && break
  sleep 3
done
docker port datacore-backend || true
EOF

echo "== Проверка с ПК публичный :8080"
pub=$(curl -s -m 8 -o /dev/null -w '%{http_code}' http://31.222.224.247:8080/api/health/ready || echo 000)
echo "PUBLIC_8080=$pub"

echo "== Recreate home backend после HA_PEER_URL"
ssh -o BatchMode=yes datacore-vm 'cd /opt/data-core && docker compose -f docker-compose.prod.yml up -d backend'
sleep 12
ssh -o BatchMode=yes datacore-vm 'curl -s -m 10 -o /dev/null -w "HOME=%{http_code}\n" http://127.0.0.1:3001/api/health/ready; docker exec datacore-backend printenv HA_PEER_URL | sed -E "s/[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+/x.x.x.x/"'

echo "== Status"
bash deploy/synology/api.sh prod GET /api/control/switch
echo
echo A4B_OK
