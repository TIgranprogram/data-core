#!/usr/bin/env bash
# Изолированный двухсторонний тест. Ни одной команды в сеть или настоящий Docker.
set -euo pipefail
base="$(cd "$(dirname "$0")/../.." && pwd)"
lab="$(mktemp -d)"
trap 'rm -rf -- "$lab"' EXIT
export HOME="$lab/home-dir" LAB="$lab" MSYS_NO_PATHCONV=1
export PATH="$HOME/bin:$PATH"
mkdir -p "$HOME/bin"
printf '#!/bin/bash\nexit 1\n' > "$HOME/bin/crontab"
cat > "$HOME/bin/ssh" <<'STUB'
#!/usr/bin/env bash
set -eu
cmd="${!#}"
[[ "$cmd" == status ]] || { echo "НЕОЖИДАННАЯ КОМАНДА SSH" >&2; exit 93; }
[[ "$(cat "$LAB/domain")" != unknown ]] || exit 1
printf 'domain=%s port=4201\nhome=up\noffice=up\n' "$(cat "$LAB/domain")"
STUB
cat > "$HOME/bin/docker" <<'STUB'
#!/usr/bin/env bash
set -eu
echo "docker $*" >> "$LAB/commands"
case "$1" in
  ps) printf 'datacore-backend\ndatacore-mongo\n'; if [[ -f "$LAB/crm" ]]; then echo kppdf-backend; fi ;;
  stop|start)
    [[ "$2" == datacore-backend ]]
    echo "$1" > "$LAB/running" ;;
  exec)
    shift
    if [[ "$1" == datacore-backend ]]; then [[ "$2 $3" == 'printenv HA_SELF' ]] && cat "$LAB/self"; exit; fi
    [[ "$1" == -i && "$2" == datacore-mongo && "$3" == sh ]]
    shift 2; export MONGO_INITDB_ROOT_USERNAME=test MONGO_INITDB_ROOT_PASSWORD=test
    exec "$@" ;;
  compose)
    if [[ " $* " == *' build backend '* ]]; then
      [[ ! -f "$LAB/buildfail" ]] || exit 8
      cp "$LAB/newimage" "$LAB/candidate"
    else
      [[ " $* " == *' up -d --no-deps --force-recreate --no-build --pull never backend '* ]]
      cp "$LAB/tag" "$LAB/active"; echo start > "$LAB/running"
    fi ;;
  image)
    if [[ "$2" == inspect ]]; then cat "$LAB/candidate"; fi ;;
  tag)
    if [[ "$3" == dc-backend:local ]]; then echo "$2" > "$LAB/tag"; fi ;;
  inspect)
    case "$3" in
      '{{.Image}}') cat "$LAB/active" ;;
      '{{.Config.Image}}') echo dc-backend:local ;;
      *project*) echo data-core ;;
      *) exit 92 ;;
    esac ;;
  *) echo "НЕОЖИДАННЫЙ DOCKER: $*" >&2; exit 93 ;;
esac
STUB
cat > "$HOME/bin/mongo" <<'STUB'
#!/usr/bin/env bash
set -eu
expr="${!#}"
case "$expr" in
  *'print(d&&d.role)'*|*'findOne({_id:"switch"}).role)'*) cat "$LAB/db/role" ;;
  *'d.scheduleRuntime===undefined'*) cat "$LAB/db/runtime" ;;
  *'var file='*)
    file="$(sed -n 's/.*var file="\([^"]*\)".*/\1/p' <<<"$expr")"
    [[ "$expr" == *'u.$set.scheduleRuntime=r'* && "$expr" == *'scheduleRuntime:1'* ]]
    cat "$file" > "$LAB/db/runtime"
    echo standby > "$LAB/db/role"
    if [[ -f "$LAB/change-owner" ]]; then echo unknown > "$LAB/domain"; fi ;;
  *'getCollectionNames()'*) printf '["users","app_control_state"]\n' ;;
  *'var pairs='*) printf 'users=%s\n' "$(cat "$LAB/db/users")" ;;
  *) echo "НЕОЖИДАННЫЙ MONGO" >&2; exit 92 ;;
esac
STUB
cat > "$HOME/bin/mongorestore" <<'STUB'
#!/usr/bin/env bash
set -eu
[[ " $* " == *' --nsInclude datacore.* '* ]]
tar -xzf - -C "$LAB/db"
STUB
cat > "$HOME/bin/mongodump" <<'STUB'
#!/usr/bin/env bash
set -eu
tar -czf - -C "$LAB/db" .
STUB
cat > "$HOME/bin/curl" <<'STUB'
#!/usr/bin/env bash
set -eu
[[ "$(cat "$LAB/running")" == start ]] || exit 7
if [[ -f "$LAB/healthfail" && "$(cat "$LAB/active")" == "$(cat "$LAB/newimage")" ]]; then exit 7; fi
case "${!#}" in
  http://test/api/health/ready) echo ok ;;
  http://test/app/version.json) cat "$DC/backend/pwa/version.json" ;;
  *) echo 'НЕОЖИДАННЫЙ URL' >&2; exit 93 ;;
esac
STUB
cat > "$HOME/bin/rsync" <<'STUB'
#!/usr/bin/env bash
set -eu
dest="${!#}"; n=$(( $# - 1 )); src="${!n}"
[[ "$src" != *:* && "$dest" != *:* ]]
cp -a "$src/." "$dest/"
STUB
printf '#!/bin/bash\nexit 0\n' > "$HOME/bin/sleep"
# В Git Bash утилиты flock нет; подменяем только результат получения прежней блокировки.
real_flock="$(command -v flock || true)"
cat > "$HOME/bin/flock" <<'STUB'
#!/usr/bin/env bash
[[ ! -f "$LAB/flock-busy" ]] || exit 1
[[ -z "$REAL_FLOCK" ]] || exec "$REAL_FLOCK" "$@"
STUB
export REAL_FLOCK="$real_flock"
chmod 755 "$HOME/bin/"*
export DC="$lab/target" PD="$lab/var" EXPECT_HOST PAPI=http://test
EXPECT_HOST="$(hostname)"
source "$base/deploy/ha/switch/release-artifact.sh"
commit="$(printf '%040d' 2)"; old="$(printf '%040d' 1)"
echo "sha256:$(printf '%064d' 1)" > "$lab/oldimage"
echo "sha256:$(printf '%064d' 2)" > "$lab/newimage"
id=abc001
reset_case() {
  for f in "$DC" "$PD" "$lab/db" "$lab/in" "$lab/src"; do rm -rf -- "$f"; done
  rm -f "$lab/"{crm,buildfail,healthfail,change-owner,flock-busy}
  mkdir -p "$DC"/{backend/pwa,deploy} "$PD/switch" "$lab"/{db,in,src/backend/pwa,src/deploy}
  export EXPECT_SELF="$1"; echo "$1" > "$lab/self"
  if [[ "$1" == home ]]; then echo office > "$lab/domain"; else echo home > "$lab/domain"; fi
  printf 'HA_SELF=%s\nHA_VPS_SSH=test-vps\n' "$1" > "$PD/switch/bridge.env"
  printf 'standby\n' > "$lab/db/role"; printf 'main\n' > "$lab/in/role"
  printf '{"lastAttemptAt":"local"}\n' > "$lab/db/runtime"; printf '{"lastAttemptAt":"source"}\n' > "$lab/in/runtime"
  echo old > "$lab/db/config"; echo new > "$lab/in/config"; echo 7 > "$lab/db/users"; echo 9 > "$lab/in/users"
  echo '{"v":"1111","n":1}' > "$DC/backend/pwa/version.json"
  echo '{"v":"2222","n":2}' > "$lab/src/backend/pwa/version.json"
  echo old > "$DC/deploy/content"; echo new > "$lab/src/deploy/content"
  echo old > "$DC/docker-compose.prod.yml"; echo new > "$lab/src/docker-compose.prod.yml"
  cp "$lab/oldimage" "$lab/active"; cp "$lab/oldimage" "$lab/tag"; echo start > "$lab/running"
  echo "$old" > "$DC/.release-commit"; : > "$lab/commands"
  mkdir "$DC/.ha-stage-$id"
  tar -czf "$DC/.ha-stage-$id/release.tgz" -C "$lab/src" .
  hash="$(release_digest "$DC/.ha-stage-$id/release.tgz")"
  tar -czf "$DC/.ha-stage-$id/incoming.archive.gz" -C "$lab/in" .
}
call_peer() {
  cat "$base/deploy/ha/switch/release-artifact.sh" "$base/deploy/ha/switch/standby-release.sh" |
    bash -s -- "$1" "$id" "${2:-both}" "$commit" "$hash" 2222 normal "${3:-users=9}" > "$lab/result" 2>&1
}
ok() { "$@" || { cat "$lab/result"; echo "СБОЙ: $*" >&2; exit 1; }; }
reject() { if "$@"; then cat "$lab/result"; echo "Ожидался отказ: $*" >&2; exit 1; fi; }
old_ok() {
  [[ "$(cat "$DC/.release-commit")" == "$old" && "$(cat "$DC/deploy/content")" == old && "$(cat "$lab/db/config")" == old && "$(cat "$lab/db/users")" == 7 &&
     "$(cat "$lab/db/runtime")" == '{"lastAttemptAt":"local"}' && "$(cat "$lab/db/role")" == standby && "$(cat "$lab/active")" == "$(cat "$lab/oldimage")" && "$(cat "$lab/running")" == start ]]
}
for self in office home; do
  reset_case "$self"
  ok call_peer stage
  ok old_ok
  if grep -Eq 'docker (stop|start)| up -d ' "$lab/commands"; then exit 1; fi
  ok call_peer apply
  [[ "$(cat "$DC/.release-commit")" == "$commit" && "$(cat "$lab/db/config")" == new && "$(cat "$lab/db/users")" == 9 && "$(cat "$lab/db/runtime")" == '{"lastAttemptAt":"local"}' && "$(cat "$lab/db/role")" == standby ]]
  [[ "$(release_digest "$DC/.ha-releases/$commit/release.tgz")" == "$hash" ]]
  echo "PASS — данные, runtime и принятый архив на $self"
done
reset_case office; ok call_peer apply data
[[ "$(cat "$DC/.release-commit")" == "$old" && "$(cat "$lab/db/config")" == new && "$(cat "$lab/db/runtime")" == '{"lastAttemptAt":"local"}' ]]
echo 'PASS — только данные'
for fault in domain role crm digest buildfail flock-busy; do
  reset_case office
  case "$fault" in domain) echo unknown > "$lab/domain";; role) echo main > "$lab/db/role";; crm) touch "$lab/crm";; digest) hash="$(printf '%064d' 1)";; buildfail|flock-busy) touch "$lab/$fault";; esac
  reject call_peer stage
  [[ "$(cat "$lab/db/config")" == old && "$(cat "$DC/.release-commit")" == "$old" ]]
  if grep -Eq 'docker stop| up -d ' "$lab/commands"; then exit 1; fi
  echo "PASS — отказ до остановки при $fault"
done
reset_case office; ok call_peer stage; echo "$commit" > "$DC/.release-commit"; reject call_peer apply
[[ "$(cat "$lab/db/config")" == old ]]; echo 'PASS — смена отметки между сборкой и активацией'
for fault in health counts; do
  reset_case home; ok call_peer stage
  if [[ "$fault" == health ]]; then touch "$lab/healthfail"; reject call_peer apply; else reject call_peer apply both users=20; fi
  ok old_ok; [[ ! -e "$DC/.ha-operation" ]]
  echo "PASS — подтверждённый откат после $fault"
done
reset_case office; ok call_peer stage; touch "$lab/change-owner"; reject call_peer apply
[[ -d "$DC/.ha-operation" && "$(cat "$lab/running")" == stop ]]
echo 'PASS — неизвестный владелец запрещает запуск и мутацию для отката'
reset_case home; take_operation_lock "$DC" test-release
reject call_peer apply
[[ "$(cat "$DC/.ha-operation/owner")" == test-release && "$(cat "$lab/db/config")" == old ]]
echo 'PASS — взаимоисключение с выпуском'
