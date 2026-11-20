#!/usr/bin/env bash
# Вход только от switch-watch через stdin SSH. Вызов выполняется на запасном.
# Формат: stage|apply job scope commit sha pwaHash mode expectedCounts.
set -euo pipefail
umask 077
action=$1 id=$2 scope=$3 commit=$4 digest=$5 version=$6 mode=$7 counts=$8
[[ "$id" =~ ^[a-f0-9]{6,32}$ && "$action" =~ ^(stage|apply)$ && "$scope" =~ ^(both|data)$ && "$mode" =~ ^(normal|readonly)$ ]]
cd "$DC"
[[ -n "$EXPECT_HOST" && "$(hostname)" == "$EXPECT_HOST" ]]
. "$PD/switch/bridge.env"
[[ "$HA_SELF" == "$EXPECT_SELF" && "$HA_SELF" =~ ^(office|home)$ ]]
case "$HA_SELF" in home) owner=office ;; office) owner=home ;; esac
stage="$DC/.ha-stage-$id"
incoming="$stage/incoming.archive.gz"
snapshot="$PD/switch/before-switch-$(date -u +%Y%m%d%H%M%S)-$id.archive.gz"
candidate="datacore-ha-candidate-$id:local"
prior="$stage/prior"
dirty=0
stopped=0
code_dirty=0
committed=0
vps_owner() {
  local out
  local opts=(-o BatchMode=yes -o ConnectTimeout=5)
  [[ -z "${HA_VPS_KEY:-}" ]] || opts+=(-i "$HA_VPS_KEY")
  out="$(timeout 20 ssh "${opts[@]}" "${HA_VPS_SSH:?}" status)" &&
    grep -Eq "^domain=$owner port=[0-9]+$" <<<"$out"
}
mongo_cmd() {
  local tool=$1; shift
  docker exec -i datacore-mongo sh -c 'tool=$1; shift; exec "$tool" -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin "$@"' sh "$tool" "$@"
}
js() { mongo_cmd mongo --quiet datacore --eval "$1"; }
identity() {
  [[ "$(docker exec datacore-backend printenv HA_SELF)" == "$EXPECT_SELF" ]] &&
    [[ "$(js 'var d=db.app_control_state.findOne({_id:"switch"}); print(d&&d.role)')" == standby ]] &&
    ! grep -Fxq 'kppdf-backend' <<<"$containers"
}
health() {
  local i
  for i in $(seq 1 40); do
    if curl -fsS --max-time 5 "$PAPI/api/health/ready" >/dev/null; then return 0; fi
    sleep 3
  done
  return 1
}
restore_from() { mongo_cmd mongorestore --quiet --stopOnError --drop --archive --gzip --nsInclude 'datacore.*' < "$1"; }
compose_up() {
  docker compose -p "$project" -f docker-compose.prod.yml up -d --no-deps --force-recreate --no-build --pull never backend
}
# Хостовые исключения остаются на месте. Команда rsync работает только внутри этого хоста.
sync_tree() {
  PATH="$HOME/bin:$PATH" rsync -a --checksum --delete --exclude='.env' --exclude='*.env' --exclude='CREDENTIALS*' --exclude='*.key' --exclude='*.pem' --exclude='secrets/' --exclude='/uploads/' --exclude='/dist/' --exclude='/node_modules/' "$1/" "$2/"
}
install_code() {
  sync_tree "$1/backend" backend && sync_tree "$1/deploy" deploy &&
    cp -p "$1/docker-compose.prod.yml" docker-compose.prod.yml
}
rollback() {
  vps_owner || return 1
  if (( dirty )); then
    docker stop datacore-backend >/dev/null || return 1
    restore_from "$snapshot" || return 1
    # mongorestore --drop восстанавливает только коллекции из архива. Созданные кандидатом
    # коллекции сохраняем отдельно, чтобы прежний backend вновь видел точный набор таблиц.
    js "var before=$collections; db.getCollectionNames().filter(function(n){return before.indexOf(n)<0 && n.indexOf('system.')!==0}).forEach(function(n){assert.commandWorked(db.adminCommand({renameCollection:'datacore.'+n,to:'datacore_ha_failed_$id.'+n}))})" >/dev/null || return 1
  fi
  if (( code_dirty )); then
    install_code "$prior" && docker tag "$old_image" "$image_name" && compose_up || return 1
  else
    docker start datacore-backend >/dev/null || return 1
  fi
  health && cmp -s "$stage/old-version.json" <(curl -fsS --max-time 5 "$PAPI/app/version.json") || return 1
  if (( code_dirty )); then
    if [[ -s "$prior/marker" ]]; then cp "$prior/marker" .release-commit; else rm -f .release-commit; fi
  fi
}
leave() {
  local rc=$?
  trap - EXIT HUP INT TERM
  set +e
  if (( stopped && !committed )); then
    if ! rollback; then
      echo "ОТКАТ НЕ ПОДТВЕРЖДЁН. Сохранены блокировка, код и снимок $snapshot. Нужна проверка запасного." >&2
      exit 70
    fi
    echo "Предыдущие данные и backend восстановлены, health и версия подтверждены." >&2
  fi
  if [[ "$action" == apply || "$rc" != 0 ]]; then
    [[ ! -d "$stage" ]] || rm -rf -- "$stage"
    if [[ "$scope" == both ]]; then docker image rm "$candidate" >/dev/null 2>&1 || true; docker image rm "datacore-ha-prior-$id:local" >/dev/null 2>&1 || true; fi
  fi
  if [[ "$mode" == readonly && "$committed" == 1 && "$rc" == 0 ]]; then
    # Обычное переключение удерживает запасной до подтверждённого переноса домена.
    touch "$DC/.ha-operation/switch-ready" || exit 71
  else
    release_operation_lock "$DC" "peer-$id" || exit 71
  fi
  exit "$rc"
}
take_operation_lock "$DC" "peer-$id"
trap leave EXIT
trap 'exit 72' HUP INT TERM
hold_watch_lock "$DC" "$PD/switch" "peer-$id" || { echo "Мост запасного уже выполняет работу"; exit 24; }
containers="$(docker ps --format '{{.Names}}')"
vps_owner && identity || { echo 'Владелец домена, роль или изоляция запасного не подтверждены.' >&2; exit 23; }
if [[ "$scope" == both ]]; then
  [[ "$commit" =~ ^[a-f0-9]{40}$ && "$digest" =~ ^[a-f0-9]{64}$ && "$version" =~ ^[a-f0-9]{4,40}$ ]]
  [[ -d "$stage" && ! -L "$stage" && "$(release_digest "$stage/release.tgz")" == "$digest" ]]
fi
if [[ "$action" == stage ]]; then
  [[ "$scope" == both ]]
  mkdir "$stage/source"
  tar -xzf "$stage/release.tgz" -C "$stage/source"
  [[ -d "$stage/source/deploy" && -f "$stage/source/docker-compose.prod.yml" ]]
  if [[ -f .release-commit ]]; then cp .release-commit "$stage/was-release"; else touch "$stage/was-release"; fi
  if [[ "$(cat "$stage/was-release")" != "$commit" ]] ||
      ! cmp -s "$stage/source/backend/pwa/version.json" <(curl -fsS --max-time 5 "$PAPI/app/version.json"); then
    # Собираем ровно backend из compose кандидата под отдельной меткой. Контейнеры не запускаются.
    printf 'services:\n  backend:\n    image: %s\n' "$candidate" > "$stage/image.yml"
    docker compose --env-file "$DC/.env" -f "$stage/source/docker-compose.prod.yml" -f "$stage/image.yml" build backend
    docker image inspect --format '{{.Id}}' "$candidate" > "$stage/image"
    grep -Eq '^sha256:[a-f0-9]{64}$' "$stage/image"
  fi
  touch "$stage/prepared"
  exit 0
fi
[[ -d "$stage" && ! -L "$stage" ]]
if [[ "$scope" == both ]]; then
  current="$(cat .release-commit 2>/dev/null || true)"
  [[ "$current" == "$(cat "$stage/was-release")" ]]
fi
gzip -t "$incoming"
[[ "$counts" =~ ^[a-zA-Z0-9_]+=[0-9]+(,[a-zA-Z0-9_]+=[0-9]+)*$ ]]
curl -fsS --max-time 5 "$PAPI/app/version.json" > "$stage/old-version.json"
if [[ -s "$stage/image" ]]; then
  old_image="$(docker inspect -f '{{.Image}}' datacore-backend)"
  image_name="$(docker inspect -f '{{.Config.Image}}' datacore-backend)"
  project="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' datacore-backend)"
  [[ "$old_image" =~ ^sha256:[a-f0-9]{64}$ && -n "$image_name" && -n "$project" ]]
  docker tag "$old_image" "datacore-ha-prior-$id:local"
  mkdir "$prior"
  cp -al backend deploy "$prior/"
  cp -p docker-compose.prod.yml "$prior/"
  cp "$stage/was-release" "$prior/marker"
fi
vps_owner && identity || exit 23
docker stop datacore-backend >/dev/null
stopped=1
snapshot_tmp="$(mktemp "$PD/switch/.before-$id-XXXXXXXX")"
mongo_cmd mongodump --quiet --db datacore --archive --gzip > "$snapshot_tmp"
gzip -t "$snapshot_tmp"
mv -fT "$snapshot_tmp" "$snapshot"
collections="$(js 'print(JSON.stringify(db.getCollectionNames()))')"
[[ "$collections" == '['*']' ]]
runtime="$(js 'var d=db.app_control_state.findOne({_id:"switch"}); if(!d||d.role!=="standby")quit(42); print(JSON.stringify(d.scheduleRuntime===undefined?null:d.scheduleRuntime))')"
[[ -n "$runtime" ]]
vps_owner || exit 23
dirty=1
restore_from "$incoming"
# Mongo 4.4: JSON передаётся как файл данных через stdin, не как исполняемый код.
runtime_js='var r=JSON.parse(cat(file)); var u={$set:{role:"standby",mode:mode}}; if(mode==="normal")u.$set.job=null; if(r===null)u.$unset={scheduleRuntime:1};else u.$set.scheduleRuntime=r; var w=db.app_control_state.updateOne({_id:"switch"},u); assert.eq(w.matchedCount,1);'
printf '%s' "$runtime" | docker exec -i datacore-mongo sh -c '
  f=$(mktemp) || exit 1; trap '\''rm -f "$f"'\'' EXIT
  cat > "$f" || exit 1
  mongo --quiet -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin datacore --eval "var file=\"$f\",mode=\"$1\"; $2"' sh "$mode" "$runtime_js" >/dev/null
vps_owner || exit 23
if [[ -s "$stage/image" ]]; then
  code_dirty=1
  rm -f .release-commit
  install_code "$stage/source"
  docker tag "$(cat "$stage/image")" "$image_name"
  compose_up
else
  docker start datacore-backend >/dev/null
fi
health
if [[ "$scope" == both ]]; then
  curl -fsS --max-time 5 "$PAPI/app/version.json" > "$stage/live-version.json"
  cmp -s "$stage/source/backend/pwa/version.json" "$stage/live-version.json"
fi
actual="$(js "var pairs='$counts'.split(',');print(pairs.map(function(p){var n=p.split('=')[0];return n+'='+db.getCollection(n).count()}).join(','))")"
[[ "$actual" == "$counts" ]]
[[ "$(js 'print(db.app_control_state.findOne({_id:"switch"}).role)')" == standby ]]
vps_owner || exit 23
if [[ "$scope" == both ]]; then
  publish_artifact "$DC" "$stage/release.tgz" "$commit" "$digest" "$version"
  rotate_artifacts "$DC" || true
fi
committed=1
rm -f "$incoming"
# Только после успешного завершения сохраняем три последних страховочных дампа.
find "$PD/switch" -maxdepth 1 -type f -name 'before-switch-*.archive.gz' -printf '%T@ %p\n' | sort -rn | tail -n +4 | cut -d ' ' -f2- | while IFS= read -r old; do rm -f -- "$old"; done
