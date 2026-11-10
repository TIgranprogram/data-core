#!/usr/bin/env bash
# C058 A4: HA_PEER_URL Дома → http://VPS:4203; закрыть WAN :3001; хеши секретов.
set -euo pipefail

VM() { ssh -o BatchMode=yes -o ConnectTimeout=20 datacore-vm "$@"; }
ERP() { ssh -i "$HOME/.ssh/erp_server" -o BatchMode=yes -o ConnectTimeout=20 erpadmin@sportin.netcraze.pro "$@"; }

echo "== VPS_TARGET"
VPS_TARGET="$(VM 'crontab -l 2>/dev/null | grep -o "VPS_TARGET=[^ ]*" | head -1 | cut -d= -f2')"
[[ -n "$VPS_TARGET" ]] || { echo "СТОП: нет VPS_TARGET"; exit 2; }
VPS_HOST="${VPS_TARGET#*@}"
echo "VPS_HOST_LEN=${#VPS_HOST}"

echo "== health через VPS:4203"
code="$(VM "ssh -o BatchMode=yes -o ConnectTimeout=15 $(printf %q "$VPS_TARGET") \"curl -s -m 8 -o /dev/null -w '%{http_code}' http://127.0.0.1:4203/api/health/ready\"" || echo 000)"
echo "VPS_4203_HEALTH=$code"
[[ "$code" == "200" ]] || { echo "СТОП: :4203 не healthy"; exit 3; }

echo "== HA_PEER_URL на Доме"
VM "bash -s" <<EOF
set -euo pipefail
cd /opt/data-core
ts=\$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p /var/lib/datacore/backups/c058
cp -a .env /var/lib/datacore/backups/c058/env-peer-\$ts.bak
url='http://${VPS_HOST}:4203'
if grep -q '^HA_PEER_URL=' .env; then
  sed -i "s|^HA_PEER_URL=.*|HA_PEER_URL=\${url}|" .env
else
  printf '\nHA_PEER_URL=%s\n' "\$url" >> .env
fi
grep '^HA_PEER_URL=' .env | sed -E 's/[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+/x.x.x.x/'
echo PEER_URL_SET
EOF

echo "== Хеши JWT/BACKUP (без значений)"
hash_one() {
  "$@" 'bash -s' <<'H'
set -euo pipefail
cd /opt/data-core
set -a; . ./.env; set +a
printf 'JWT=%s\n' "$(printf %s "$JWT_SECRET" | sha256sum | awk '{print $1}')"
printf 'BAK=%s\n' "$(printf %s "${BACKUP_SECRET_KEY:-}" | sha256sum | awk '{print $1}')"
H
}
H_VM=$(hash_one VM)
H_ERP=$(hash_one ERP)
echo "VM  $H_VM"
echo "ERP $H_ERP"
jv=$(echo "$H_VM" | awk -F= '/^JWT=/{print $2}')
je=$(echo "$H_ERP" | awk -F= '/^JWT=/{print $2}')
bv=$(echo "$H_VM" | awk -F= '/^BAK=/{print $2}')
be=$(echo "$H_ERP" | awk -F= '/^BAK=/{print $2}')
[[ -n "$jv" && "$jv" == "$je" ]] && echo JWT_HASH_MATCH || echo JWT_HASH_DIFF
[[ -n "$bv" && "$bv" == "$be" ]] && echo BAK_HASH_MATCH || echo BAK_HASH_DIFF

echo "== Firewall DOCKER-USER :3001 (C058-A4)"
ERP 'bash -s' <<'EOF'
set -euo pipefail
if sudo iptables -S DOCKER-USER 2>/dev/null | grep -q 'C058-A4'; then
  echo FIREWALL_ALREADY
else
  sudo iptables -N DOCKER-USER 2>/dev/null || true
  sudo iptables -I DOCKER-USER -p tcp --dport 3001 -s 127.0.0.1 -j ACCEPT -m comment --comment C058-A4
  sudo iptables -I DOCKER-USER -p tcp --dport 3001 -i lo -j ACCEPT -m comment --comment C058-A4
  sudo iptables -A DOCKER-USER -p tcp --dport 3001 -j DROP -m comment --comment C058-A4
  echo FIREWALL_APPLIED
fi
sudo iptables -S DOCKER-USER | grep C058-A4 || true
curl -s -m 5 -o /dev/null -w 'LOCAL_HEALTH=%{http_code}\n' http://127.0.0.1:3001/api/health/ready
EOF

echo "== Проверка с ПК: публичный :8080 должен отвалиться (или timeout)"
pub=$(curl -s -m 8 -o /dev/null -w '%{http_code}' http://31.222.224.247:8080/api/health/ready || echo 000)
echo "PUBLIC_8080=$pub"
echo A4_SCRIPT_OK
