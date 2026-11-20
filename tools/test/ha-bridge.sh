#!/usr/bin/env bash
# Проверяем реальный switch-watch с изолированными API, двумя хостами и VPS.
# Логику самой команды на принимающем хосте проверяет ha-standby.sh.
set -euo pipefail
base="$(cd "$(dirname "$0")/../.." && pwd)"
lab="$(mktemp -d)"
trap 'rm -rf -- "$lab"' EXIT
export LAB="$lab" HOME="$lab/home" PATH="$lab/home/bin:$PATH"
mkdir -p "$HOME/bin"
export DC_DIR="$lab/source" DATA_DIR="$lab/data" HA_SWITCH_DIR_HOST="$lab/data/switch"
export HA_PEER_DC_DIR="$lab/peer" HA_PEER_DATA="$lab/peer-data" HA_API=http://mock HA_PEER_API=http://peer
export HA_PEER_SSH=mock-peer HA_PEER_HOST=peer-host HA_VPS_SSH=mock-vps HA_COUNT_COLLS=users
export PEER_INFO_EVERY=0 MSYS_NO_PATHCONV=1
mkdir -p "$DC_DIR" "$HA_PEER_DC_DIR" "$HA_SWITCH_DIR_HOST" "$DATA_DIR/uploads" "$HA_PEER_DATA/switch"
chmod 1777 "$HA_SWITCH_DIR_HOST"
# NTFS в Git Bash не хранит sticky-бит. Его поведение отдельно проверяет ha-owner.sh на Linux tmpfs.
case "$(uname -s)" in
  MSYS*|MINGW*)
    export NATIVE_STAT="$(command -v stat)"
    cat > "$HOME/bin/stat" <<'STUB'
#!/usr/bin/env bash
if [[ "$1" == -c && "$2" == '%u:%g:%a' && "${!#}" == "$HA_SWITCH_DIR_HOST" ]]; then
  printf '%s:%s:1777\n' "$(id -u)" "$(id -g)"; exit
fi
exec "$NATIVE_STAT" "$@"
STUB
    ;;
esac
printf mock > "$HA_PEER_DATA/switch/secret"
printf '#!/bin/bash\nexit 0\n' > "$HOME/bin/flock"
cp "$HOME/bin/flock" "$HOME/bin/sleep"
cat > "$HOME/bin/rsync" <<'STUB'
#!/usr/bin/env bash
[[ "$*" == *'--ignore-existing'* && "$*" == *'/uploads/'* ]] || exit 90
echo photos >> "$LAB/actions"
STUB
cat > "$HOME/bin/docker" <<'STUB'
#!/usr/bin/env bash
set -eu
case "$*" in
  'exec -i datacore-backend node '*) shift 3; exec "$@" ;;
  'ps --format {{.Names}}') echo datacore-backend ;;
  *'mongodump '*) echo dump ;;
  *'backuptargets.updateMany'*) echo 2 ;;
  *'cs.map('*) echo users=9 ;;
  *) echo "НЕОЖИДАННЫЙ docker: $*" >&2; exit 90 ;;
esac
STUB
cat > "$HOME/bin/curl" <<'STUB'
#!/usr/bin/env bash
set -eu
file='' body='' method=''
while (( $# )); do
  case "$1" in -o) file="$2"; shift 2 ;; -d) body="$2"; shift 2 ;; *) method="$1"; shift ;; esac
done
if [[ "$method" == http://mock/api/health/ready ]]; then echo -n 200; exit 0; fi
if [[ "$method" == http://peer/api/control/switch/report ]]; then
  echo "$body" >> "$LAB/peer-reports"
  if [[ "$body" == *'"role":"main"'* ]]; then echo main > "$LAB/peer-role"; fi
  rid="$(cat "$LAB/id")"; state=running
  if [[ "$body" == *'"state":"done"'* ]]; then
    [[ ! -f "$LAB/final-503" ]] || { echo -n 503; exit; }
    if [[ -e "$LAB/foreign-409" || -e "$LAB/same-409" ]]; then echo -n 409; exit; fi
    state=done
  elif [[ "$body" == '{"id":"peer"}' && -f "$LAB/foreign-409" ]]; then rid=bbbbbb; state=done
  elif [[ "$body" == '{"id":"peer"}' && -f "$LAB/same-409" ]]; then state=done; fi
  printf '{"ok":true,"role":"%s","mode":"normal","job":{"id":"%s","state":"%s"}}' "$(cat "$LAB/peer-role")" "$rid" "$state" > "$file"
  echo -n 200; exit
fi
[[ "$method" == http://mock/api/control/switch/report ]]
echo "$body" >> "$LAB/reports"
if [[ -f "$LAB/terminal-offline" && "$body" == *'"state":"failed"'* ]]; then echo -n 503; exit 0; fi
if [[ -f "$LAB/source-409" && "$body" == *'"state":"done"'* && "$body" == *'"role":"standby"'* ]]; then echo -n 409; exit; fi
if [[ -f "$LAB/source-409" && "$body" == '{"id":"peer"}' ]] && grep -Fxq phase=terminal "$HA_SWITCH_DIR_HOST/current" 2>/dev/null; then
  rid=bbbbbb
  if [[ -f "$LAB/source-same" ]]; then rid="$(cat "$LAB/id")"; echo standby > "$LAB/role"; fi
  printf '{"ok":true,"role":"standby","mode":"readonly","job":{"id":"%s","state":"done"}}' "$rid" > "$file"
  echo -n 200; exit
fi
if [[ "$body" == *'"role":"standby"'* ]]; then echo standby > "$LAB/role"; fi
if [[ "$body" == *'"role":"main"'* ]]; then echo main > "$LAB/role"; fi
printf '{"ok":true,"role":"%s","mode":"normal","job":{"id":"%s"}}' "$(cat "$LAB/role")" "$(cat "$LAB/id")" > "$file"
echo -n 200
STUB
cat > "$HOME/bin/ssh" <<'STUB'
#!/usr/bin/env bash
set -eu
cmd="${!#}"; n=$(( $# - 1 )); host="${!n}"
if [[ "$host" == mock-vps ]]; then
  case "$cmd" in
    status) owner="$(cat "$LAB/domain")"; [[ "$owner" != unknown ]] || exit 1
      printf 'domain=%s port=4201\nhome=up\noffice=up\n' "$owner" ;;
    home|office) [[ "$(cat "$LAB/peer-role")" == main ]]; echo "$cmd" > "$LAB/domain"; echo "vps-$cmd" >> "$LAB/actions" ;;
    *) exit 91 ;;
  esac; exit 0
fi
[[ "$host" == mock-peer ]]
case "$cmd" in
  *'export DC PD PAPI EXPECT_HOST EXPECT_SELF; bash -s')
    cat >/dev/null; [[ "$(cat "$LAB/peer-role")" == standby ]];;
  *'export DC; bash -s --'*) cat >/dev/null; rm -f "$LAB/hold" ;;
  *'test -f "$DC/.ha-operation/switch-ready"'*) [[ -f "$LAB/hold" ]] ;;
  *'export DC PD PAPI EXPECT_HOST EXPECT_SELF; bash -s --'*)
    cat >/dev/null; touch "$LAB/hold"
    [[ "$(cat "$LAB/domain")" == "$HA_SELF" && "$(cat "$LAB/peer-role")" == standby ]]
    echo restore >> "$LAB/actions" ;;
  *'mkdir .ha-stage-'*'/release.tgz'*)
    cat > "$LAB/copied-release"
    if [[ -f "$LAB/change-source" ]]; then echo 1111111111111111111111111111111111111111 > "$DC_DIR/.release-commit"; fi ;;
  *'S=$(cat '*)
    exec bash -c "$cmd" ;;
  *'test ! -d "$DC/.ha-operation"'*) [[ ! -f "$LAB/quarantine" ]] ;;
  *'EXPECT_HOST'*) # Допустимы только заранее известные операции.
    if [[ "$cmd" == *'cs.map('* ]]; then echo users=9
    elif [[ "$cmd" == *'Восстановление отменено.'* ]]; then [[ "$(cat "$LAB/peer-role")" == standby ]]
    else echo "НЕОЖИДАННАЯ КОМАНДА peer_vars" >&2; exit 91; fi ;;
  *'/app/version.json'*) echo '{"v":"12345678","n":10,"b":"abcd1234"}' ;;
  *'/api/health/ready'*) echo 200 ;;
  *'/switch/last-refresh'*) date -u +%Y-%m-%dT%H:%M:%SZ ;;
  *'docker inspect -f'*) echo true ;;
  'echo ok') echo ok ;;
  *'command -v rsync'*) : ;;
  *'df --output=avail'*) echo 9999999 ;;
  *'incoming.archive.gz'*) cat >/dev/null; if [[ -f "$LAB/disappear" ]]; then echo unknown > "$LAB/domain"; fi ;;
  *'mkdir '*|'test -w '*) : ;;
  *) echo "НЕОЖИДАННАЯ КОМАНДА ssh: $cmd" >&2; exit 91 ;;
esac
STUB
chmod +x "$HOME/bin/"*
echo abc001 > "$lab/id"; echo main > "$lab/role"; echo standby > "$lab/peer-role"; : > "$lab/actions"
export HA_SELF=home
run_bridge() { bash "$base/deploy/ha/switch/switch-watch.sh"; }
queue() {
  echo "$1" > "$lab/id"
  printf 'id=%s\nkind=%s\n%s\n' "$1" "$2" "${3:-}" > "$HA_SWITCH_DIR_HOST/request"
}
assert_report() { grep -Fq "$1" "$lab/reports" || { cat "$lab/reports"; exit 1; }; }
echo unknown > "$lab/domain"; run_bridge; assert_report '"owner":null,"homeHealthy":null,"officeHealthy":null'
echo home > "$lab/domain"; run_bridge; assert_report '"owner":"home","homeHealthy":true,"officeHealthy":true'
touch "$lab/quarantine"; : > "$lab/reports"; run_bridge; assert_report '"healthy":false'; rm "$lab/quarantine"
echo 'PASS — свежий статус VPS, неизвестный ответ, изоляция запасного'
queue abc002 refresh 'expiresAt=2000-01-01T00:00:00Z'
touch "$lab/terminal-offline"; if run_bridge; then exit 1; fi
grep -Fxq 'phase=terminal' "$HA_SWITCH_DIR_HOST/current"
rm "$lab/terminal-offline"; run_bridge
[[ ! -e "$HA_SWITCH_DIR_HOST/current" && ! -s "$lab/actions" ]]
assert_report 'Разрешённое окно расписания закончилось.'
echo 'PASS — истёкший слот и доставка результата после восстановления API'
echo unknown > "$lab/domain"; queue abc003 refresh 'code=0'
if run_bridge; then exit 1; fi
assert_report 'Не подтверждены владелец домена'
[[ ! -s "$lab/actions" ]]
echo 'PASS — автоматическая заявка при неизвестном владельце'
# Поток pinned bytes проходит по тому же соединению, что на хосте; изменение marker
# в момент передачи обязано остановить работу до build/readonly/дампа.
source "$base/deploy/ha/switch/release-artifact.sh"
echo home > "$lab/domain"; echo accepted > "$lab/accepted"
sha="$(release_digest "$lab/accepted")"; commit=2222222222222222222222222222222222222222
publish_artifact "$DC_DIR" "$lab/accepted" "$commit" "$sha" 2222
touch "$lab/change-source"; queue abc006 refresh
if run_bridge; then exit 1; fi
[[ ! -s "$lab/actions" && "$(cat "$lab/copied-release")" == accepted ]]
assert_report 'Не удалось проверить архив принятого выпуска'
rm "$lab/change-source"; echo "$commit" > "$DC_DIR/.release-commit"
echo changed > "$lab/other"
if publish_artifact "$DC_DIR" "$lab/other" "$commit" "$(release_digest "$lab/other")" 2222; then exit 1; fi
[[ "$(release_digest "$DC_DIR/.ha-releases/$commit/release.tgz")" == "$sha" ]]
echo 'PASS — смена отметки источника при передаче и неизменяемость принятого архива'
queue abc007 refresh 'code=0'; echo home > "$lab/domain"; : > "$lab/actions"; touch "$lab/disappear"
if run_bridge; then exit 1; fi
grep -Fxq 'phase=ownership' "$HA_SWITCH_DIR_HOST/current"
if grep -Fxq restore "$lab/actions"; then exit 1; fi
echo office > "$lab/domain"; rm "$lab/disappear"; run_bridge
assert_report 'Домен у соседа, этот сервер переведён в запасные.'
[[ "$(cat "$lab/role")" == standby && ! -e "$HA_SWITCH_DIR_HOST/current" ]]
echo 'PASS — потеря VPS во время readonly и подтверждение чужого владения после перезапуска'
for direction in home office; do
  export HA_SELF="$direction"
  if [[ "$direction" == home ]]; then other=office; id=abc004; else other=home; id=abc005; fi
  echo "$direction" > "$lab/domain"; echo main > "$lab/role"; echo standby > "$lab/peer-role"
  : > "$lab/actions"; queue "$id" switch
  if ! run_bridge; then tail -10 "$HA_SWITCH_DIR_HOST/switch.log"; cat "$lab/actions"; exit 1; fi
  [[ "$(cat "$lab/domain")" == "$other" && "$(cat "$lab/role")" == standby && "$(cat "$lab/peer-role")" == main ]]
  grep -Fxq restore "$lab/actions"
  grep -Fxq "vps-$other" "$lab/actions"
  [[ ! -f "$HA_SWITCH_DIR_HOST/current" && ! -f "$HA_SWITCH_DIR_HOST/request" && ! -d "$DC_DIR/.ha-operation" ]]
  echo "PASS — ручной маршрут $direction → $other"
done
export HA_SELF=home; echo home > "$lab/domain"; echo main > "$lab/role"; echo standby > "$lab/peer-role"
: > "$lab/actions"; queue abc008 switch; touch "$lab/final-503"
if run_bridge; then exit 1; fi
grep -Fxq phase=switched "$HA_SWITCH_DIR_HOST/current"; [[ -e "$lab/hold" && "$(cat "$lab/domain")" == office ]]
rm "$lab/final-503"; touch "$lab/foreign-409"
if run_bridge; then exit 1; fi
grep -Fxq phase=switched "$HA_SWITCH_DIR_HOST/current"; [[ -e "$lab/hold" ]]
rm "$lab/foreign-409"; touch "$lab/same-409"; run_bridge
[[ ! -e "$HA_SWITCH_DIR_HOST/current" && ! -e "$lab/hold" && "$(cat "$lab/role")" == standby ]]
[[ "$(grep -Fxc vps-office "$lab/actions")" == 1 && "$(grep -Fxc restore "$lab/actions")" == 1 ]]
echo 'PASS — финал на новом главном: 503, чужой 409 и подтверждение прежнего результата без второго переключения'
rm "$lab/same-409"; echo home > "$lab/domain"; echo main > "$lab/role"; echo standby > "$lab/peer-role"
: > "$lab/actions"; queue abc009 switch; touch "$lab/source-409"
if run_bridge; then exit 1; fi
grep -Fxq phase=terminal "$HA_SWITCH_DIR_HOST/current"; [[ ! -e "$lab/hold" ]]
touch "$lab/source-same"; run_bridge
[[ ! -e "$HA_SWITCH_DIR_HOST/current" && "$(grep -Fxc vps-office "$lab/actions")" == 1 && "$(cat "$lab/role")" == standby ]]
echo 'PASS — терминальный 409 на прежнем главном принимается только для его job и роли'
