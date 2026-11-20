#!/usr/bin/env bash
# Проверка Unix-полномочий только в выделенном Linux tmpfs (контейнер без сети).
set -euo pipefail
[[ "$(uname -s)" == Linux && "$EUID" == 0 && "$(stat -f -c %T "${TMPDIR:-/tmp}")" == tmpfs ]] || { echo 'Нужен изолированный tmpfs Linux и root в нём.' >&2; exit 2; }
base="$(cd "$(dirname "$0")/../.." && pwd)"
helper="$base/deploy/ha/switch/release-artifact.sh"
watch="$base/deploy/ha/switch/switch-watch.sh"
lab="$(mktemp -d)"
cleanup() {
  local dir
  for dir in "$lab/switch" "$lab/precreated"; do
    [[ ! -d "$dir" ]] || chown -h 0:0 -- "$dir"
  done
  rm -rf -- "$lab"
}
trap cleanup EXIT
chmod 755 "$lab"
uid=15321; gid=15432
export TEST_OWNER="$uid:$gid" TEST_FLAGS="$lab/flags" TEST_QUEUE="$lab/switch"
export HA_SWITCH_DIR_HOST="$TEST_QUEUE" DATA_DIR="$lab/data" DC_DIR="$lab/code" HA_SELF=home HA_API=http://fixture
mkdir "$lab/bin" "$TEST_FLAGS" "$TEST_QUEUE" "$DATA_DIR" "$DC_DIR"; chown "$TEST_OWNER" "$TEST_FLAGS"; chmod 1777 "$TEST_QUEUE"
export PATH="$lab/bin:$PATH"
as_cron() { setpriv --reuid "$uid" --regid "$gid" --clear-groups "$@"; }
check_as_cron() { as_cron bash -c '. "$1"; "$2" "$3" "${4:-}"' test "$helper" "$@"; }
cat > "$lab/bin/sudo" <<'STUB'
#!/bin/bash
[[ "$*" == "-n chown -h -- $TEST_OWNER $TEST_QUEUE" ]] || exit 92
touch "$TEST_FLAGS/requested"
for i in {1..100}; do [[ "$(stat -c '%u:%g' "$TEST_QUEUE")" != "$TEST_OWNER" ]] || exit 0; sleep 0.05; done
exit 93
STUB
cat > "$lab/bin/crontab" <<'STUB'
#!/bin/bash
[[ "$1" == -l ]] || exit 92
[[ ! -e "$TEST_FLAGS/other" ]] || printf '# '
echo '* * * * * DATA_DIR=/var/lib/datacore /bin/bash /opt/data-core/deploy/ha/switch/switch-watch.sh >/dev/null 2>&1'
STUB
cat > "$lab/bin/curl" <<'STUB'
#!/bin/bash
[[ "${!#}" == http://fixture/api/control/switch/report ]] || exit 92
while (( $# )); do if [[ "$1" == -o ]]; then echo '{"ok":true,"role":"main","mode":"normal"}' > "$2"; break; fi; shift; done
printf 200
STUB
printf '#!/bin/bash\nexit 92\n' > "$lab/bin/ssh"; chmod 755 "$lab"/bin/*
setup() {
  # Родитель исполняет только заранее определённый chown в своём tmpfs. Команды и пути от дочернего процесса не принимает.
  local pid i
  rm -f "$TEST_FLAGS/requested"
  check_as_cron switch_queue_dir "$TEST_QUEUE" setup & pid=$!
  for i in {1..100}; do [[ ! -e "$TEST_FLAGS/requested" ]] || break; sleep 0.05; done
  [[ -e "$TEST_FLAGS/requested" ]]
  chown -h "$uid:$gid" -- "$TEST_QUEUE"
  wait "$pid"
}
printf 'id=abc002\nkind=refresh\n' > "$TEST_QUEUE/request"; chmod 644 "$TEST_QUEUE/request"
echo untouched > "$TEST_QUEUE/sentinel"; chmod 600 "$TEST_QUEUE/sentinel"
as_cron bash -c 'echo abc002 > "$TEST_QUEUE/last-id"'
if as_cron rm "$TEST_QUEUE/request" 2>/dev/null; then exit 1; fi
if as_cron bash "$watch" 2>"$lab/diagnostic"; then exit 1; fi
grep -Fq '0:0:1777' "$lab/diagnostic"; grep -Fq "$TEST_OWNER:1777" "$lab/diagnostic"
[[ ! -e "$TEST_QUEUE/alive" && ! -e "$TEST_QUEUE/current" && -e "$TEST_QUEUE/request" ]]
echo 'PASS — Linux запрещает unlink root:0644, мост отказывается до heartbeat и claim'
if check_as_cron check_upgrade_queue "$TEST_QUEUE" 2>/dev/null; then exit 1; fi
as_cron touch "$TEST_FLAGS/other"; check_as_cron check_upgrade_queue "$TEST_QUEUE"; as_cron rm "$TEST_FLAGS/other"
[[ ! -e "$TEST_FLAGS/requested" && "$(stat -c '%u:%g:%a' "$TEST_QUEUE")" == 0:0:1777 ]]
echo 'PASS — проверка обновления учитывает владельца crontab и не вызывает sudo'
setup
[[ "$(stat -c '%u:%g:%a' "$TEST_QUEUE")" == "$TEST_OWNER:1777" && "$(stat -c '%u:%g:%a' "$TEST_QUEUE/request")" == 0:0:644 ]]
[[ "$(stat -c '%u:%g:%a' "$TEST_QUEUE/sentinel")" == 0:0:600 && "$(cat "$TEST_QUEUE/sentinel")" == untouched ]]
check_as_cron switch_queue_dir "$TEST_QUEUE" setup; check_as_cron check_upgrade_queue "$TEST_QUEUE"
echo 'PASS — установка использует UID/GID cron, сохраняет дочерние файлы и их права'
as_cron bash "$watch"; [[ ! -e "$TEST_QUEUE/request" && -e "$TEST_QUEUE/alive" && ! -e "$TEST_QUEUE/current" ]]
printf 'id=abc003\nkind=refresh\nexpiresAt=2000-01-01T00:00:00Z\n' > "$TEST_QUEUE/request"; chmod 644 "$TEST_QUEUE/request"
if as_cron bash "$watch"; then exit 1; fi
[[ ! -e "$TEST_QUEUE/request" && ! -e "$TEST_QUEUE/current" && "$(cat "$TEST_QUEUE/last-id")" == abc003 ]]
echo 'PASS — мост убирает прежнюю root-заявку, затем принимает следующую'
touch "$TEST_FLAGS/other"
source "$helper"
if switch_queue_dir "$TEST_QUEUE" setup 2>/dev/null; then exit 1; fi
[[ "$(stat -c '%u:%g:%a' "$TEST_QUEUE")" == "$TEST_OWNER:1777" ]]
rm "$TEST_FLAGS/other"
echo 'PASS — повторная установка из чужой учётной записи сохраняет владельца очереди'
export TEST_QUEUE="$lab/precreated"; mkdir -m 0755 "$TEST_QUEUE"; setup
[[ "$(stat -c '%u:%g:%a' "$TEST_QUEUE")" == "$TEST_OWNER:1777" && "$(stat -c %u "$TEST_QUEUE/.lock")" == "$uid" ]]
ln -s "$TEST_QUEUE" "$lab/link"
if check_as_cron switch_queue_dir "$lab/link" setup; then exit 1; fi
echo 'PASS — свежий bind-каталог 0755 и отказ для символьной ссылки'
