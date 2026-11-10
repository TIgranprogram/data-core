#!/usr/bin/env bash
# Починить ProxyCommand на Sportin и вернуть Дом главным.
set -eu

echo "== Переписать HA_PEER_PROXY без ломаных кавычек"
VPS_TARGET="$(ssh -o BatchMode=yes datacore-vm 'crontab -l | grep -o "VPS_TARGET=[^ ]*" | head -1 | cut -d= -f2')"
VM_HOST="$(ssh -o BatchMode=yes datacore-vm hostname)"
ssh -i "$HOME/.ssh/erp_server" -o BatchMode=yes erpadmin@sportin.netcraze.pro "bash -s" <<EOF
set -eu
d=/var/lib/datacore/switch
cp -a "\$d/bridge.env" "\$d/bridge.env.bak-c058"
# пересобрать файл целиком (секреты-пути стандартные)
cat > "\$d/bridge.env" <<E2
HA_SELF=office
HA_PEER_SSH=tiit@127.0.0.1
HA_PEER_HOST=$VM_HOST
HA_PEER_PORT=4222
HA_PEER_KEY=\$HOME/.ssh/dc_transfer
HA_PEER_PROXY=ssh -i \$HOME/.ssh/dc_hop -o BatchMode=yes -o StrictHostKeyChecking=accept-new -W %h:%p $VPS_TARGET
HA_VPS_SSH=$VPS_TARGET
HA_VPS_KEY=\$HOME/.ssh/dc_switch
E2
chmod 600 "\$d/bridge.env"
# показать форму
grep -E '^[A-Z_]+=' "\$d/bridge.env" | sed -E 's/(KEY)=.*/\\1=SET/; s/[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+/x.x.x.x/g'
# тест peer ssh
set -a; . "\$d/bridge.env"; set +a
ssh -o BatchMode=yes -o ConnectTimeout=15 -p "\$HA_PEER_PORT" -o "ProxyCommand=\$HA_PEER_PROXY" -i "\$HA_PEER_KEY" "\$HA_PEER_SSH" 'echo PEER_SSH_OK'
# тест rsync photos dry
RSH="ssh -o BatchMode=yes -o ConnectTimeout=15 -p \$HA_PEER_PORT -o ProxyCommand=\$HA_PEER_PROXY -i \$HA_PEER_KEY"
# правильнее через массив как в скрипте — короткий вызов
timeout 45 env PATH="\$HOME/bin:/usr/bin:/bin" rsync --rsync-path='\$HOME/bin/rsync' -rtn --ignore-existing \
  -e "ssh -o BatchMode=yes -o ConnectTimeout=20 -p \$HA_PEER_PORT -i \$HA_PEER_KEY -o ProxyCommand=\$HA_PEER_PROXY" \
  /var/lib/datacore/uploads/ "\$HA_PEER_SSH:/var/lib/datacore/uploads/" 2>&1 | sed -n '1,15p' || true
echo PROXY_FIX_OK
EOF

echo "== Повтор office→home"
CONF="$(pwd)/docs/crew/C058-two-servers-finish/tmp/confirm-start.json"
printf '{"confirm":true}\n' > "$CONF"
bash deploy/synology/api.sh prod POST /api/control/switch/start "$CONF"
echo
for i in $(seq 1 100); do
  js=$(bash deploy/synology/api.sh prod GET /api/control/switch || echo '{}')
  echo "[$i] $(echo "$js" | tr -d '\n' | cut -c1-350)"
  self=$(echo "$js" | sed -n 's/.*"self":"\([^"]*\)".*/\1/p' | head -1)
  role=$(echo "$js" | sed -n 's/.*"role":"\([^"]*\)".*/\1/p' | head -1)
  state=$(echo "$js" | sed -n 's/.*"state":"\([^"]*\)".*/\1/p' | head -1)
  if echo "$js" | grep -q '"state":"failed"'; then echo FAILED; echo "$js"; exit 3; fi
  if [[ "$self" == "home" && "$role" == "main" ]]; then
    if echo "$js" | grep -qE '"job":null|"state":"done"'; then echo HOME_MAIN_OK; break; fi
  fi
  sleep 10
done
curl -s -m 15 -o /dev/null -w 'SITE=%{http_code}\n' https://kppdf-crm.ru/db/api/health/ready
ssh -o BatchMode=yes datacore-vm 'docker start kppdf-backend >/dev/null 2>&1 || true; docker ps --filter name=kppdf-backend --format "{{.Names}} {{.Status}}"'
bash deploy/synology/api.sh prod GET /api/control/switch
echo
echo RETURN2_DONE
