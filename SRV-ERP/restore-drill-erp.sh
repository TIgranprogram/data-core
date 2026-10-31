#!/usr/bin/env bash
# Учебное восстановление второго сервера (Sportin). Запуск с ПК из корня репо: bash SRV-ERP/restore-drill-erp.sh
# Берёт последний srv-erp-*.tgz, разворачивает базу во временную datacore_drill, сверяет число записей
# с рабочей базой, удаляет временную. Рабочая база и файлы не меняются.
set -euo pipefail
KEY="${KEY:-$HOME/.ssh/erp_server}"; HOST="${HOST:-erpadmin@sportin.netcraze.pro}"
ssh -i "$KEY" -o BatchMode=yes "$HOST" 'bash -s' <<'REMOTE'
set -euo pipefail
B=/var/lib/datacore/backups
F="$(ls -1t $B/srv-erp-*.tgz 2>/dev/null | head -1 || true)"
[[ -n "$F" ]] || { echo "СТОП: копий srv-erp-*.tgz нет"; exit 2; }
echo "== Копия: $(basename "$F") ($(du -h "$F" | cut -f1))"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
tar -C "$T" -xzf "$F" ./mongo.archive.gz
[[ -s "$T/mongo.archive.gz" ]] || { echo "СТОП: в архиве нет базы"; exit 2; }
tar -tzf "$F" ./uploads.tgz >/dev/null 2>&1 && echo "Фото в архиве: есть" || echo "Фото в архиве: нет"
M='mongo --quiet -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin'
docker exec -i datacore-mongo sh -c "mongorestore --quiet -u \"\$MONGO_INITDB_ROOT_USERNAME\" -p \"\$MONGO_INITDB_ROOT_PASSWORD\" --authenticationDatabase admin --gzip --archive --nsFrom='datacore.*' --nsTo='datacore_drill.*' --drop" < "$T/mongo.archive.gz"
CNT='var o={};db.getCollectionNames().forEach(function(c){o[c]=db.getCollection(c).count()});print(JSON.stringify(o))'
A="$(docker exec datacore-mongo sh -c "$M datacore --eval '$CNT'")"
D="$(docker exec datacore-mongo sh -c "$M datacore_drill --eval '$CNT'")"
docker exec datacore-mongo sh -c "$M datacore_drill --eval 'db.dropDatabase()'" >/dev/null
echo "$A" > "$T/a.json"; echo "$D" > "$T/d.json"
python3 - "$T/a.json" "$T/d.json" <<'PY'
import json,sys
a=json.load(open(sys.argv[1])); d=json.load(open(sys.argv[2]))
miss=[c for c in a if c not in d and a[c]>0]
diff=[(c,a[c],d.get(c,0)) for c in a if c in d and d[c]<a[c]*0.9]
print(f"Таблиц в рабочей базе: {len(a)}, в копии: {len(d)}, записей в копии: {sum(d.values())}")
for c,x,y in diff[:10]: print(f"  меньше в копии: {c} {y} из {x}")
for c in miss[:10]: print(f"  нет в копии: {c}")
print("ИТОГ: копия восстанавливается" if not miss and not diff else "ИТОГ: расхождения — смотреть выше (новые записи после копии — норма)")
PY
echo "Временная база удалена. Рабочая не менялась."
REMOTE
