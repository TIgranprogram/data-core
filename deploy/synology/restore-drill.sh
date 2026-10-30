#!/bin/bash
# Учебное восстановление: последняя копия разворачивается во временную базу, числа сверяются с рабочей, база удаляется.
# Запуск на VM раз в месяц: cd /opt/data-core && bash deploy/synology/restore-drill.sh
# Рабочую базу не меняет. Итог дописывается в <DATA_DIR>/backups/drill.log (его читает doctor.sh).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
[[ -f "$ENV_FILE" ]] || ENV_FILE="${SCRIPT_DIR}/../../.env"
[[ -f "$ENV_FILE" ]] && set -a && source "$ENV_FILE" && set +a
DATA_DIR="${DATA_DIR:-/var/lib/datacore}"
MONGO_CONTAINER="${MONGO_CONTAINER:-datacore-mongo}"
MONGO_DB="${MONGO_DB:-datacore}"
MONGO_ROOT_USER="${MONGO_ROOT_USER:-root}"
DRILL_DB="${MONGO_DB}_drill"
: "${MONGO_ROOT_PASSWORD:?MONGO_ROOT_PASSWORD не задан}"
BACKUP_ROOT="${DATA_DIR}/backups"
LATEST="$(ls -1dt "$BACKUP_ROOT"/mongo-20* | head -1)"
[[ -d "$LATEST/$MONGO_DB" ]] || { echo "нет копии базы в $LATEST"; exit 1; }
TMP="/tmp/drill-$$"
sh_mongo() { docker exec -i "$MONGO_CONTAINER" sh -c "BIN=\$(command -v mongosh || command -v mongo); \$BIN --quiet -u '$MONGO_ROOT_USER' -p '$MONGO_ROOT_PASSWORD' --authenticationDatabase admin admin"; }
drop() { echo "db.getSiblingDB('$DRILL_DB').dropDatabase()" | sh_mongo >/dev/null 2>&1 || true; docker exec "$MONGO_CONTAINER" rm -rf "$TMP" || true; }
trap drop EXIT

docker cp "$LATEST/$MONGO_DB" "$MONGO_CONTAINER:$TMP"
docker exec "$MONGO_CONTAINER" mongorestore --quiet -u "$MONGO_ROOT_USER" -p "$MONGO_ROOT_PASSWORD" --authenticationDatabase admin --db "$DRILL_DB" "$TMP"

# Копия старше базы: новые записи допустимы. Сбой — коллекция пропала или в копии записей меньше половины рабочих.
REPORT="$(sh_mongo <<JS
var a = db.getSiblingDB('$MONGO_DB'), b = db.getSiblingDB('$DRILL_DB'), n = 0, docs = 0, bad = [];
a.getCollectionNames().sort().forEach(function (c) {
  if (c.indexOf('system.') === 0) return;
  var x = a.getCollection(c).countDocuments({}), y = b.getCollection(c).countDocuments({});
  n++; docs += y;
  if (x > 0 && y * 2 < x) bad.push(c + ':' + y + '/' + x);
});
print('RESULT ' + n + ' ' + docs + ' ' + bad.join(','));
JS
)"
LINE="$(printf '%s\n' "$REPORT" | grep '^RESULT' | tail -1)"
read -r _ COLLS DOCS BAD <<<"$LINE"
[[ -n "${COLLS:-}" ]] || { echo "сверка не выполнена: $REPORT"; exit 1; }
STATE=ok; [[ -z "${BAD:-}" ]] || STATE=fail
echo "$(date +%F) $STATE $(basename "$LATEST") коллекций=$COLLS записей=$DOCS ${BAD:-}" | tee -a "$BACKUP_ROOT/drill.log"
[[ "$STATE" == ok ]]
