#!/usr/bin/env bash
set -eu
echo "== HOME role main"
ssh -o BatchMode=yes datacore-vm 'bash -s' <<'EOF'
set -eu
cd /opt/data-core; set -a; . ./.env; set +a
docker exec -e MONGO_ROOT_USER -e MONGO_ROOT_PASSWORD datacore-mongo \
  mongo --quiet -u "$MONGO_ROOT_USER" -p "$MONGO_ROOT_PASSWORD" --authenticationDatabase admin datacore \
  --eval 'db.app_control_state.updateOne({_id:"switch"},{$set:{role:"main",mode:"normal",job:null}},{upsert:true}); print("HOME="+db.app_control_state.findOne({_id:"switch"}).role+"/"+db.app_control_state.findOne({_id:"switch"}).mode)'
rm -f /var/lib/datacore/switch/current 2>/dev/null || true
docker start kppdf-backend >/dev/null 2>&1 || true
sleep 2
curl -s -m 8 -o /dev/null -w "HOME_API=%{http_code}\n" http://127.0.0.1:3001/api/health/ready
docker ps --filter name=kppdf-backend --format "{{.Names}} {{.Status}}"
EOF

echo "== ERP role standby"
ssh -i "$HOME/.ssh/erp_server" -o BatchMode=yes erpadmin@sportin.netcraze.pro 'bash -s' <<'EOF'
set -eu
cd /opt/data-core; set -a; . ./.env; set +a
docker exec -e MONGO_ROOT_USER -e MONGO_ROOT_PASSWORD datacore-mongo \
  mongo --quiet -u "$MONGO_ROOT_USER" -p "$MONGO_ROOT_PASSWORD" --authenticationDatabase admin datacore \
  --eval 'db.app_control_state.updateOne({_id:"switch"},{$set:{role:"standby",mode:"normal",job:null}},{upsert:true}); print("ERP="+db.app_control_state.findOne({_id:"switch"}).role+"/"+db.app_control_state.findOne({_id:"switch"}).mode)'
rm -f /var/lib/datacore/switch/current 2>/dev/null || true
curl -s -m 8 -o /dev/null -w "ERP_API=%{http_code}\n" http://127.0.0.1:3001/api/health/ready
EOF

sleep 3
curl -s -m 15 -o /dev/null -w "SITE=%{http_code}\n" https://kppdf-crm.ru/db/api/health/ready
bash deploy/synology/api.sh prod GET /api/control/switch
echo
echo ROLES_OK
