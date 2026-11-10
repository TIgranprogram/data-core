#!/usr/bin/env bash
# Аварийный возврат: домен → home, роли main/standby, CRM up. Без rsync photos.
set -eu
cd "$(git rev-parse --show-toplevel)"

echo "== dc-switch home с VM"
ssh -o BatchMode=yes datacore-vm 'bash -s' <<'EOF'
set -eu
VPS=$(crontab -l | grep -o "VPS_TARGET=[^ ]*" | head -1 | cut -d= -f2)
ssh -i "$HOME/.ssh/dc_switch" -o BatchMode=yes -o ConnectTimeout=20 "$VPS" home
ssh -i "$HOME/.ssh/dc_switch" -o BatchMode=yes "$VPS" status | head -5
EOF

echo "== Роли в Mongo: Дом main, Sportin standby"
ssh -o BatchMode=yes datacore-vm 'bash -s' <<'EOF'
set -eu
cd /opt/data-core; set -a; . ./.env; set +a
docker exec -e MONGO_ROOT_USER -e MONGO_ROOT_PASSWORD datacore-mongo sh -c \
  'mongo --quiet -u "$MONGO_ROOT_USER" -p "$MONGO_ROOT_PASSWORD" --authenticationDatabase admin datacore --eval
  "db.app_control_state.updateOne({_id:\"switch\"},{\$set:{role:\"main\",mode:\"normal\",job:null,peerHealthy:true}},{upsert:true}); print(\"HOME_ROLE=\"+db.app_control_state.findOne({_id:\"switch\"}).role)"'
docker start kppdf-backend >/dev/null 2>&1 || true
sleep 3
curl -s -m 10 -o /dev/null -w "HOME_API=%{http_code}\n" http://127.0.0.1:3001/api/health/ready
docker ps --filter name=kppdf-backend --format "{{.Names}} {{.Status}}"
EOF

ssh -i "$HOME/.ssh/erp_server" -o BatchMode=yes erpadmin@sportin.netcraze.pro 'bash -s' <<'EOF'
set -eu
cd /opt/data-core; set -a; . ./.env; set +a
docker exec -e MONGO_ROOT_USER -e MONGO_ROOT_PASSWORD datacore-mongo sh -c \
  'mongo --quiet -u "$MONGO_ROOT_USER" -p "$MONGO_ROOT_PASSWORD" --authenticationDatabase admin datacore --eval
  "db.app_control_state.updateOne({_id:\"switch\"},{\$set:{role:\"standby\",mode:\"normal\",job:null}},{upsert:true}); print(\"ERP_ROLE=\"+db.app_control_state.findOne({_id:\"switch\"}).role)"'
# сбросить заявку на диске если зависла
rm -f /var/lib/datacore/switch/current 2>/dev/null || true
curl -s -m 10 -o /dev/null -w "ERP_API=%{http_code}\n" http://127.0.0.1:3001/api/health/ready
EOF

sleep 5
echo "== Проверка снаружи"
curl -s -m 15 -o /dev/null -w "SITE=%{http_code}\n" https://kppdf-crm.ru/db/api/health/ready
bash deploy/synology/api.sh prod GET /api/control/switch
echo
echo EMERGENCY_HOME_DONE
