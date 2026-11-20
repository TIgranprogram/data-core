#!/bin/bash
{ # C135: весь файл читается до запуска — выкладка, заменившая скрипт во время работы, не собьёт мост
# switch-watch.sh — хост-мост «Переключить сейчас» (HA-TWO-SERVERS, SW-4/SW-5). По образцу bundle-watch.sh.
# Cron пользователя деплоя раз в минуту, на КАЖДОМ из двух серверов:
#   * * * * * DATA_DIR=/var/lib/datacore bash /opt/data-core/deploy/ha/switch/switch-watch.sh
# Контейнер backend сам ничего на хосте не запускает: кнопка в админке кладёт файл
#   ${DATA_DIR}/switch/request   (id=…, kind=switch|emergency|refresh)
# мост его подхватывает и по шагам докладывает серверу: POST /api/control/switch/report с секретом из файла
#   ${DATA_DIR}/switch/secret    (chmod 600; backend в контейнере работает от root и читает его; в аргументах и логах секрета нет).
# Идемпотентен: нет заявки — тихо выходит; уже работает другой экземпляр (flock) — тихо выходит.
# set -x НЕ использовать: читается .env с паролями. Пароль Mongo в argv хоста не попадает (docker exec -e ИМЯ, значение из окружения).
#
# Настройки — в окружении cron или в ${DATA_DIR}/switch/bridge.env (его пишет SRV-ERP/setup-switch.sh):
#   HA_SELF                home|office (иначе из .env)         HA_PEER_SSH   user@host второго сервера
#   HA_PEER_HOST           hostname второго сервера (ОБЯЗАТЕЛЕН: защита от переключения «не на тот сервер»)
#   HA_PEER_PORT (22)      HA_PEER_KEY  ключ для передачи      HA_PEER_PROXY ProxyCommand (Sportin → VM через VPS :4222)
#   HA_PEER_DC_DIR (/opt/data-core)  HA_PEER_DATA (/var/lib/datacore)  HA_PEER_API (http://127.0.0.1:3001)
#   HA_VPS_SSH root@vps    HA_VPS_KEY  ключ ТОЛЬКО для dc-switch   HA_API (http://127.0.0.1:3001)
#   HA_COUNT_COLLS  коллекции для сверки (по умолчанию 5 главных)
# Порядок при kind=switch: проверка (в т.ч. сосед: hostname, HA_SELF, role=standby) → фото заранее (rsync --ignore-existing)
# → readonly (дальше не более 10 минут) → дамп → передача → восстановление на втором (страховочный дамп с отметкой времени, хранится 3;
# сосед сразу становится standby) → короткая досинхронизация фото → сверка записей и health → второй главный
# → VPS (dc-switch, домен подтверждается `dc-switch status`) → цели копий вне дома выключаются здесь → этот standby+readonly.
# kind=refresh проверяет владельца на VPS, готовит принятый архив и собирает образ до паузы.
# На запасном выполняется операция со страховочным снимком, откатом и проверкой до фиксации.
# Локальный cron сообщает о маршрутах VPS и защищает вернувшийся старый главный.
set -uo pipefail
umask 077

DATA_DIR="${DATA_DIR:-/var/lib/datacore}"
DC_DIR="${DC_DIR:-/opt/data-core}"
SW_DIR="${HA_SWITCH_DIR_HOST:-${DATA_DIR}/switch}"
mkdir -p "$SW_DIR"
# в каталоге пишет контейнер (root) — sticky-бит, как у /tmp; владелец каталога (пользователь моста) всё равно может удалять заявку
chmod 1777 "$SW_DIR" 2>/dev/null || true
CONF="${HA_BRIDGE_ENV:-${SW_DIR}/bridge.env}"
# shellcheck disable=SC1090
[[ -f "$CONF" ]] && . "$CONF"

REQ="${SW_DIR}/request"
SECRET_FILE="${SW_DIR}/secret"
CURRENT="${SW_DIR}/current"
LOG="${SW_DIR}/switch.log"
API="${HA_API:-http://127.0.0.1:3001}"
PEER_DC="${HA_PEER_DC_DIR:-/opt/data-core}"
PEER_DATA="${HA_PEER_DATA:-/var/lib/datacore}"
PEER_API="${HA_PEER_API:-http://127.0.0.1:3001}"
COLLS="${HA_COUNT_COLLS:-users salesorders incomes materials stockmovements}"
# таймауты шагов, секунд; всё время в режиме «только чтение» ограничено RO_BUDGET (10 минут)
T_SSH="${T_SSH:-30}"; T_DUMP="${T_DUMP:-300}"; T_RESTORE="${T_RESTORE:-300}"; T_PHOTOS="${T_PHOTOS:-3600}"; T_PHOTOS_RO="${T_PHOTOS_RO:-120}"
T_VERIFY="${T_VERIFY:-120}"; T_VPS="${T_VPS:-60}"; T_REPORT="${T_REPORT:-15}"; T_CODE="${T_CODE:-600}"
RO_BUDGET="${RO_BUDGET:-600}"
PEER_INFO_EVERY="${PEER_INFO_EVERY:-60}"

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
L() { printf '%s %s\n' "$(now)" "$*" >> "$LOG"; }
# строка → JSON-строка (без python/node на хосте)
jstr() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr '\t' ' ' | sed -e ':a;N;$!ba;s/\n/\\n/g'; }
envval() { grep -m1 "^$1=" "$DC_DIR/.env" 2>/dev/null | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'\$//"; }

: >> "$LOG"; chmod 600 "$LOG" 2>/dev/null || true
if [[ $(wc -l < "$LOG") -gt 2000 ]]; then tail -n 1000 "$LOG" > "${LOG}.old" && mv -f "${LOG}.old" "$LOG"; fi

# секрет для отчётов: создаём один раз; права 600 (контейнер читает его от root)
if [[ ! -s "$SECRET_FILE" ]]; then
  head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n' > "${SECRET_FILE}.tmp" && mv -f "${SECRET_FILE}.tmp" "$SECRET_FILE"
fi
chmod 600 "$SECRET_FILE" 2>/dev/null || true
SECRET="$(tr -d '\n' < "$SECRET_FILE")"
touch "${SW_DIR}/alive"; chmod 644 "${SW_DIR}/alive" 2>/dev/null || true

SELF="${HA_SELF:-$(envval HA_SELF)}"
case "$SELF" in home) PEER_NAME=office ;; office) PEER_NAME=home ;; *) exit 0 ;; esac   # механизм выключен

HELPERS="$(cd "$(dirname "$0")" && pwd)"
. "$HELPERS/release-artifact.sh" || exit 1
exec 9>"${SW_DIR}/.lock"
flock -n 9 || exit 0

# ---------- ssh/vps ----------
PEER_OPTS=(-o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=4 -o StrictHostKeyChecking=accept-new)
[[ -n "${HA_PEER_KEY:-}" ]] && PEER_OPTS+=(-i "$HA_PEER_KEY")
[[ -n "${HA_PEER_PORT:-}" ]] && PEER_OPTS+=(-p "$HA_PEER_PORT")
[[ -n "${HA_PEER_PROXY:-}" ]] && PEER_OPTS+=(-o "ProxyCommand=$HA_PEER_PROXY" -o "UserKnownHostsFile=${SW_DIR}/known_hosts")
VPS_OPTS=(-o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o StrictHostKeyChecking=accept-new)
[[ -n "${HA_VPS_KEY:-}" ]] && VPS_OPTS+=(-i "$HA_VPS_KEY")
RSH="ssh"; for o in "${PEER_OPTS[@]}"; do RSH+=" $(printf '%q' "$o")"; done

peer() { local t="$1"; shift; timeout "$t" ssh "${PEER_OPTS[@]}" "$HA_PEER_SSH" "$@"; }
vps() { timeout "$T_VPS" ssh "${VPS_OPTS[@]}" "$HA_VPS_SSH" "$@"; }
# переменные для скриптов, выполняемых на втором сервере (обычные, не экспортируемые)
peer_vars() { printf 'DC=%q PD=%q PAPI=%q EXPECT_HOST=%q EXPECT_SELF=%q; ' "$PEER_DC" "$PEER_DATA" "$PEER_API" "${HA_PEER_HOST:-}" "$PEER_NAME"; }

# ---------- отчёты серверу ----------
LAST_REPLY=""; LAST_ERR=""
post_report() {
  local hf rf code i; hf="$(mktemp)" || return 1; rf="$(mktemp)" || return 1
  printf 'X-Switch-Secret: %s\n' "$SECRET" > "$hf"
  for i in 1 2 3; do
    code="$(curl -sS -m "$T_REPORT" -o "$rf" -w '%{http_code}' -H @"$hf" -H 'Content-Type: application/json' -d "$1" "$API/api/control/switch/report" 2>>"$LOG")"
    [[ "$code" == 200 ]] && { LAST_REPLY="$(cat "$rf")"; rm -f "$hf" "$rf"; return 0; }
    LAST_ERR="код ${code:-нет ответа}: $(sed -n 's/.*"message"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$rf" 2>/dev/null | head -c 200)"
    L "отчёт не принят ($LAST_ERR), попытка $i"
    [[ "$code" == 409 ]] && break   # работа чужая или завершена — повтор не поможет
    sleep 3
  done
  rm -f "$hf" "$rf"; return 1
}
# понятная причина отказа (C135): 403 — секрет/HA_SELF, 409 — работа уже не эта, иначе — сервер не ответил
report_why() {
  case "$LAST_ERR" in
    "код 403"*) echo "Сервер отклонил отчёт моста: неверный секрет или HA_SELF ($LAST_ERR)." ;;
    "код 409"*) echo "Сервер считает эту работу завершённой или чужой: мост, похоже, запустил её повторно ($LAST_ERR)." ;;
    *) echo "Сервер не ответил на отчёт моста ($LAST_ERR)." ;;
  esac
}
terminal_report() {
  local body="$1"
  post_report "$body" && return 0
  [[ "$LAST_ERR" == 'код 409'* ]] && post_report '{"id":"peer"}' || return 1
  printf '%s' "$LAST_REPLY" | docker exec -i datacore-backend node -e '
    const q=JSON.parse(process.argv[1]), d=JSON.parse(require("fs").readFileSync(0,"utf8"));
    const match=d.ok===true && d.job?.id===q.id && d.job.state===q.state &&
      (!q.role || q.role===d.role) && (!q.mode || q.mode===d.mode);
    process.exit(match?0:1)' "$body"
}
# report ID STEP STATE [ПРЕДУПРЕЖДЕНИЕ/ОШИБКА] [EXTRA-JSON-ФРАГМЕНТ]
report() {
  local b="{\"id\":\"$1\",\"step\":\"$2\",\"state\":\"$3\""
  [[ -n "${4:-}" ]] && b+=",\"error\":\"$(jstr "$4")\""
  [[ -n "${5:-}" ]] && b+=",$5"
  b+='}'
  if [[ "$3" == done || "$3" == failed ]]; then
    printf 'phase=terminal\nid=%s\nkind=%s\nbody=%s\n' "$1" "$KIND" "$b" > "$CURRENT.new" && mv -f "$CURRENT.new" "$CURRENT" || return 1
    if terminal_report "$b"; then rm -f "$CURRENT"; return 0; fi
    return 1
  fi
  post_report "$b"
}
# то же на втором сервере: его секрет читаем там же, тело идёт через stdin
DONE_REPLY_JS='const d=JSON.parse(require("fs").readFileSync(0,"utf8"));process.exit(d.ok===true&&d.role==="main"&&d.mode==="normal"&&d.job?.id===process.argv[1]&&d.job.state==="done"?0:1)'
read -r -d '' PEER_REPORT_SH <<'E'
set -eu
S=$(cat "$PD/switch/secret"); H=$(mktemp); R=$(mktemp)
trap 'rm -f "$H" "$R"' EXIT
printf 'X-Switch-Secret: %s\n' "$S" > "$H"
B=$(cat)
send() { curl -sS -m 15 -o "$R" -w '%{http_code}' -H @"$H" -H 'Content-Type: application/json' -d "$1" "$PAPI/api/control/switch/report"; }
c=$(send "$B")
if [ -z "$VERIFY_DONE" ]; then [ "$c" = 200 ]; exit; fi
# Доставка могла пройти до разрыва связи. 409 сам по себе не подтверждает именно нашу работу.
if [ "$c" = 409 ]; then c=$(send '{"id":"peer"}'); fi
[ "$c" = 200 ] || exit 1
docker exec -i datacore-backend node -e "$DONE_JS" "$VERIFY_DONE" < "$R"
E
peer_report() {
  printf '%s' "$1" | peer "$T_SSH" "$(peer_vars)VERIFY_DONE=$(printf '%q' "${2:-}") DONE_JS=$(printf '%q' "$DONE_REPLY_JS"); $PEER_REPORT_SH"
}

# ---------- Mongo (пароль не в argv: docker exec -e ИМЯ берёт значение из окружения) ----------
LOCAL_CREDS() {
  MONGO_ROOT_USER="$(envval MONGO_ROOT_USER)"; MONGO_ROOT_PASSWORD="$(envval MONGO_ROOT_PASSWORD)"
  MONGO_ROOT_USER="${MONGO_ROOT_USER:-root}"; export MONGO_ROOT_USER MONGO_ROOT_PASSWORD
}
DX='docker exec -e MONGO_ROOT_USER -e MONGO_ROOT_PASSWORD'
MONGO_AUTH='-u "$MONGO_ROOT_USER" -p "$MONGO_ROOT_PASSWORD" --authenticationDatabase admin'
COUNTS_SH="$DX -e COLLS datacore-mongo sh -c 'mongo --quiet $MONGO_AUTH datacore --eval \"var cs=\\\"\$COLLS\\\".split(\\\" \\\"); print(cs.map(function(c){return c+\\\"=\\\"+db.getCollection(c).count()}).join(\\\",\\\"))\"'"
counts_local() { COLLS="$COLLS" timeout "$(cap "$T_VERIFY")" bash -c "$COUNTS_SH"; }
counts_peer() { peer "$(cap "$T_VERIFY")" "$(peer_vars)cd \"\$DC\" && set -a && . ./.env && set +a && export COLLS=$(printf '%q' "$COLLS"); $COUNTS_SH"; }
dump_local() { timeout "$(cap "$T_DUMP")" $DX datacore-mongo sh -c "mongodump --quiet $MONGO_AUTH --db datacore --archive --gzip"; }
# выключить цели копий вне дома на ЭТОМ сервере (на новом главном они остаются как были в дампе)
targets_off() { timeout "$T_VERIFY" bash -c "$DX datacore-mongo sh -c 'mongo --quiet $MONGO_AUTH datacore --eval \"var r=db.backuptargets.updateMany({_id:{\\\$ne:\\\"settings\\\"}},{\\\$set:{enabled:false}}); print(r.matchedCount)\"'" >>"$LOG" 2>&1; }

# ---------- скрипты, выполняемые НА втором сервере ----------
read -r -d '' CHECK_SH <<'E'
set -uo pipefail
cd "$DC" 2>/dev/null && set -a && . ./.env && set +a || { echo "На втором сервере нет $DC/.env."; exit 20; }
[ -n "$EXPECT_HOST" ] && [ "$(hostname)" = "$EXPECT_HOST" ] || { echo "Второй сервер называется не $EXPECT_HOST: это не тот сервер. Восстановление отменено."; exit 21; }
[ "${HA_SELF:-}" = "$EXPECT_SELF" ] || { echo "На втором сервере в .env HA_SELF не равен $EXPECT_SELF. Восстановление отменено."; exit 22; }
[[ ! -d "$DC/.ha-operation" ]] || { echo "Запасной занят выкладкой или требует проверки после прерванной операции."; exit 24; }
containers="$(docker ps --format '{{.Names}}')" || exit 24
! grep -Fxq kppdf-backend <<<"$containers" || { echo "На запасном CRM kppdf пишет в ту же базу. Восстановление отменено."; exit 25; }
R=$(docker exec -e MONGO_ROOT_USER -e MONGO_ROOT_PASSWORD datacore-mongo sh -c 'mongo --quiet -u "$MONGO_ROOT_USER" -p "$MONGO_ROOT_PASSWORD" --authenticationDatabase admin datacore --eval "var d=db.app_control_state.findOne({_id:\"switch\"}); print(d?d.role:\"\")"' 2>/dev/null | tr -d '[:space:]')
[ "$R" = standby ] || { echo "Второй сервер не запасной (role=${R:-нет}). Восстановление отменено."; exit 23; }
E
peer_health() { [[ "$(peer "$T_SSH" "curl -s -m 5 -o /dev/null -w '%{http_code}' $(printf '%q' "$PEER_API")/api/health/ready" 2>/dev/null)" == 200 ]]; }
# Версия приложения соседа: /app/version.json {"v":"hash","n":612} → «v1.612» (как в меню приложения); без n — хеш сборки.
# Нужна для C042-A5: backend не даёт переключиться, пока версии кода на серверах разные.
version_of() { local s n b; s="$(cat)"; n="$(sed -n 's/.*"n"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' <<<"$s" | head -n 1)"; b="$(sed -n 's/.*"b"[[:space:]]*:[[:space:]]*"\([0-9a-f]*\)".*/\1/p' <<<"$s" | head -n 1)"; if [[ -n "$n" ]]; then printf 'v%s%s' "$(if (( n < 1000 )); then echo "1.$n"; else echo "$(( 2 + (n - 1000) / 999 )).$(( (n - 1000) % 999 + 1 ))"; fi)" "${b:+ · $b}"; else sed -n 's/.*"v"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' <<<"$s" | head -n 1 | head -c 60; fi; }
# Если переключение прервано после повышения, снимаем только роль и job этой передачи.
held_by_switch() { printf 'test -f "$DC/.ha-operation/switch-ready" && test "$(cat "$DC/.ha-operation/owner")" = peer-%s' "$ID"; }
unlock_peer() {
  local cmd
  cmd="$(peer_vars)export DC; bash -s -- $(printf '%q' "$ID")"
  { cat "$HELPERS/release-artifact.sh"; printf '%s\n' 'if [[ -d "$DC/.ha-operation" ]]; then [[ -f "$DC/.ha-operation/switch-ready" ]] && release_operation_lock "$DC" "peer-$1"; fi'; } |
    peer "$T_SSH" "$cmd"
}
peer_cancel_switch() {
  [[ "$KIND" == switch && "$ID" =~ ^[a-f0-9]{6,32}$ ]] || return 0
  domain_now; [[ "$DOM" == "$SELF" ]] || return 1
  local cancel
  cancel='var r=db.app_control_state.updateOne({_id:"switch","job.id":"JOB_ID"},{$set:{role:"standby",mode:"readonly",job:null}}); assert.eq(r.matchedCount,1)'
  cancel="${cancel/JOB_ID/$ID}"
  peer "$T_SSH" "$(peer_vars) test \"\$(hostname)\" = \"\$EXPECT_HOST\" && $(held_by_switch) && docker exec datacore-mongo sh -c 'exec mongo --quiet -u \"\$MONGO_INITDB_ROOT_USERNAME\" -p \"\$MONGO_INITDB_ROOT_PASSWORD\" --authenticationDatabase admin datacore --eval \"\$1\"' sh $(printf '%q' "$cancel")" >>"$LOG" 2>&1 && unlock_peer
}
# сведения о втором сервере для экрана: версия, возраст копии, health
peer_info() {
  local ver="" copy="" healthy=false x
  if peer "$T_SSH" "$(peer_vars)test ! -d \"\$DC/.ha-operation\"" && peer_health; then
    healthy=true
    ver="$(peer "$T_SSH" "curl -s -m 5 $(printf '%q' "$PEER_API")/app/version.json" 2>/dev/null | version_of)"
  fi
  copy="$(peer "$T_SSH" "cat $(printf '%q' "$PEER_DATA")/switch/last-refresh 2>/dev/null" 2>/dev/null | head -n 1 | tr -dc '0-9TZ:.-')"
  x="\"healthy\":$healthy"
  [[ -n "$ver" ]] && x+=",\"version\":\"$(jstr "$ver")\""
  [[ -n "$copy" ]] && x+=",\"copyAt\":\"$copy\""
  post_report "{\"id\":\"peer\",\"peer\":{$x}}" || L "сведения о втором сервере не доставлены"
}

# ---------- домен ----------
# где сейчас домен по `dc-switch status`: home | office | пусто (VPS не ответил — неизвестно)
# Результат — в глобальных DOM и VPS_STATUS (без подоболочки, чтобы вызывающий видел оба).
VPS_STATUS=""; DOM=""
domain_now() {
  VPS_STATUS=""
  if [[ -n "${HA_VPS_SSH:-}" ]]; then VPS_STATUS="$(vps status 2>/dev/null)" || VPS_STATUS=""; fi
  DOM="$(sed -n 's/^domain=\(home\|office\) port=[0-9][0-9]*$/\1/p' <<<"$VPS_STATUS" | head -n 1)"
  [[ "$DOM" == home || "$DOM" == office ]] || DOM=""
  return 0
}
route_health() {
  if grep -Fxq "$1=up" <<<"$VPS_STATUS"; then echo true
  elif grep -Fxq "$1=down" <<<"$VPS_STATUS"; then echo false
  else echo null; fi
}
self_guard() {
  domain_now
  local owner=null
  [[ -z "$DOM" ]] || owner="\"$DOM\""
  post_report "{\"id\":\"peer\",\"domain\":{\"owner\":$owner,\"homeHealthy\":$(route_health home),\"officeHealthy\":$(route_health office),\"checkedAt\":\"$(now)\"}}" || return 0
  if [[ -n "$DOM" && "$DOM" != "$SELF" && "$LAST_REPLY" == *'"role":"main"'* ]]; then
    post_report '{"id":"self","role":"standby","mode":"readonly"}' || L "не удалось стать запасным: идёт работа?"
  fi
}
assert_source() {
  domain_now
  [[ "$DOM" == "$SELF" ]] && post_report '{"id":"peer"}' &&
    [[ "$LAST_REPLY" == *'"role":"main"'* && "$LAST_REPLY" == *"\"id\":\"$ID\""* ]] ||
    fail "$1" "Не подтверждены владелец домена, роль главного и текущая заявка. Операция остановлена."
}
# ---------- бюджет «только чтения» ----------
READONLY_AT=0
left() { echo $(( RO_BUDGET - ($(date +%s) - READONLY_AT) )); }
# таймаут шага не больше оставшегося бюджета (минимум 1 с)
cap() { local l; l=$(left); (( READONLY_AT == 0 )) && { echo "$1"; return; }; (( l < 1 )) && l=1; (( $1 < l )) && echo "$1" || echo "$l"; }
check_budget() { (( READONLY_AT == 0 )) || [[ $(left) -gt 0 ]] || fail "$1" "Больше 10 минут в режиме «только чтение»: переключение отменено, сайт снова пишет."; }

# ---------- провал и откат ----------
ID=""; KIND=""; RESTORE_STARTED=0; NOCODE=""
fail() {   # fail STEP "понятная причина"; вызывается, только когда домен точно НЕ у соседа
  local msg="$2"
  L "ОШИБКА [$1]: $msg"
  if [[ "$KIND" == refresh && "$ID" =~ ^[a-f0-9]{6,32}$ && -n "${HA_PEER_SSH:-}" ]]; then
    # Нереализованный candidate можно убрать только до stop/snapshot и при свободном хосте.
    peer "$T_SSH" "$(peer_vars)cd \"\$DC\" && test ! -d .ha-operation && test -f .ha-stage-$ID/prepared && test ! -e .ha-stage-$ID/old-version.json && rm -rf -- .ha-stage-$ID && docker image rm datacore-ha-candidate-$ID:local >/dev/null 2>&1" >>"$LOG" 2>&1 || true
  fi
  if [[ "$RESTORE_STARTED" == 1 ]]; then
    if [[ "$KIND" == switch ]]; then peer_cancel_switch || L "Проверить роль второго сервера"; fi
    post_report '{"id":"peer","peer":{"healthy":false}}' || true
  fi
  local extra=""
  if [[ "$KIND" == switch || "$KIND" == refresh ]]; then
    domain_now
    if [[ "$DOM" == "$PEER_NAME" ]]; then
      extra='"role":"standby","mode":"readonly"'
    elif [[ -z "$DOM" && "$READONLY_AT" != 0 ]]; then
      # База главного уже на паузе. Возвращать право записи можно лишь после ответа VPS.
      printf 'phase=ownership\nid=%s\nkind=%s\n' "$ID" "$KIND" > "$CURRENT.new" && mv -f "$CURRENT.new" "$CURRENT"
      L "Владелец неизвестен, режим записи определит следующий цикл"; exit 1
    fi
  fi
  report "$ID" "$1" failed "$msg" "$extra" || L "отчёт о провале не доставлен; сервер снимет «только чтение» сам, когда мост перестанет отвечать"
  exit 1
}

run_step() {   # run_step STEP [ПРЕДУПРЕЖДЕНИЕ] — сообщить о шаге
  L "шаг: $1"; check_budget "$1"
  report "$ID" "$1" running "${2:-}" || fail "$1" "$(report_why)"
}
# C058: rsync может жить в $HOME/bin (без apt/sudo); --rsync-path с одинарными кавычками — HOME на удалённой стороне.
sync_photos() { timeout "$(cap "$1")" env PATH="$HOME/bin:/usr/bin:/bin" rsync --rsync-path='$HOME/bin/rsync' -rt --ignore-existing --partial -e "$RSH" "${DATA_DIR}/uploads/" "${HA_PEER_SSH}:${PEER_DATA}/uploads/" >>"$LOG" 2>&1; }
# Единственный источник кода — неизменяемый архив принятого выпуска под блокировкой хоста.
COMMIT=""; DIGEST=""; PWA_HASH=""; MANIFEST=""
verify_pin() {
  local marker
  marker="$(cat "$DC_DIR/.release-commit")" &&
    [[ "$marker" == "$COMMIT" && "$(cat "$DC_DIR/.ha-releases/$COMMIT/manifest")" == "$MANIFEST" ]]
}
peer_pipeline() {
  local action=$1 scope=$2 mode=$3 counts=$4 t=$5
  local cmd
  cmd="$(peer_vars)export DC PD PAPI EXPECT_HOST EXPECT_SELF; bash -s -- $(printf '%q ' "$action" "$ID" "$scope" "$COMMIT" "$DIGEST" "$PWA_HASH" "$mode" "$counts")"
  cat "$HELPERS/release-artifact.sh" "$HELPERS/standby-release.sh" | peer "$t" "$cmd"
}
prepare_code() {
  COMMIT="$(cat "$DC_DIR/.release-commit")" && [[ "$COMMIT" =~ ^[a-f0-9]{40}$ ]] || return 1
  local artifact="$DC_DIR/.ha-releases/$COMMIT" recorded
  MANIFEST="$(cat "$artifact/manifest")" || return 1
  read -r recorded DIGEST PWA_HASH <<<"$MANIFEST"
  [[ "$recorded" == "$COMMIT" && "$DIGEST" =~ ^[a-f0-9]{64}$ && "$PWA_HASH" =~ ^[a-f0-9]{4,40}$ ]] &&
    [[ "$(release_digest "$artifact/release.tgz")" == "$DIGEST" ]] && verify_pin || return 1
  peer "$T_CODE" "$(peer_vars)umask 077; cd \"\$DC\" && mkdir .ha-stage-$ID && cat > .ha-stage-$ID/release.tgz" < "$artifact/release.tgz" &&
    verify_pin && peer_pipeline stage both normal '' "$T_CODE" && verify_pin
}
transfer_dump() {
  local target; target="$(printf '%q' "$PEER_DC")/.ha-stage-$ID"
  if [[ "$1" == data ]]; then peer "$T_SSH" "umask 077; mkdir $target" || return 1; fi
  dump_local | peer "$(cap "$T_DUMP")" "umask 077; cat > $target/incoming.archive.gz"
}
apply_standby() {
  local scope=$1 mode=$2 before=$3 limit=$4
  assert_source restore
  if [[ "$scope" == both ]]; then verify_pin || fail restore "Изменилась отметка принятого выпуска."; fi
  local result
  if ! result="$(peer_pipeline apply "$scope" "$mode" "$before" "$limit" 2>&1)"; then
    L "Восстановление: $result"
    if [[ "$result" == *'ОТКАТ НЕ ПОДТВЕРЖДЁН'* ]]; then
      fail restore "Откат запасного не подтверждён. Его код и снимок сохранены, активация заблокирована до проверки."
    fi
    fail restore "Запасной не подтвердил обновление. Подробности и результат отката в журнале моста."
  fi
}
# после подтверждённой смены домена: сосед главный, здесь цели копий выключаем, роль здесь standby+readonly
finish_switched() {
  LOCAL_CREDS
  local ok=0 i note=""
  printf 'phase=switched\nid=%s\nkind=switch\n' "$ID" > "$CURRENT.new" && mv -f "$CURRENT.new" "$CURRENT" || exit 1
  if ! peer_report "{\"id\":\"$ID\",\"step\":\"finish\",\"state\":\"done\",\"role\":\"main\",\"mode\":\"normal\"}" "$ID" >>"$LOG" 2>&1; then
    L "Домен переключён. Новый главный пока не подтвердил завершение этой работы; захват сохранён до повторного отчёта."
    exit 1
  fi
  unlock_peer || { L "Не удалось снять захват на новом главном; подтверждение повторит следующий цикл"; exit 1; }
  if ! targets_off; then note="Цели копий вне дома на этом сервере выключить не удалось: выключите вручную в админке."; L "$note"; fi
  for i in 1 2 3 4 5; do
    report "$ID" finish done "$note" '"role":"standby","mode":"readonly"' && { ok=1; break; }
    sleep 10
  done
  [[ $ok == 1 ]] || { L "Финальный отчёт ждёт подтверждения в следующем цикле"; exit 1; }
  L "переключение $ID завершено: главный — $PEER_NAME"
  exit 0
}

preflight_peer() {
  peer "$T_SSH" 'echo ok' >/dev/null 2>&1 || fail preflight "Второй сервер недоступен по ssh."
  PATH="$HOME/bin:/usr/bin:/bin" command -v rsync >/dev/null 2>&1 || fail preflight "На этом сервере нет rsync."
  peer "$T_SSH" 'PATH="$HOME/bin:/usr/bin:/bin" command -v rsync >/dev/null' >/dev/null 2>&1 || fail preflight "На втором сервере нет rsync."
  [[ "$(peer "$T_SSH" 'docker inspect -f "{{.State.Running}}" datacore-mongo 2>/dev/null')" == true ]] || fail preflight "На втором сервере не запущена база (datacore-mongo)."
  local free; free="$(peer "$T_SSH" "df --output=avail -k $(printf '%q' "$PEER_DATA") | tail -n 1" 2>/dev/null | tr -dc 0-9)"
  [[ -n "$free" && "$free" -gt 1048576 ]] || fail preflight "На втором сервере меньше 1 ГБ свободного места."
  peer "$T_SSH" "test -w $(printf '%q' "$PEER_DATA")/switch" >/dev/null 2>&1 || fail preflight "Недоступна папка переключения на запасном."
  local why; why="$(peer "$T_SSH" "$(peer_vars)export DC PD PAPI EXPECT_HOST EXPECT_SELF; bash -s" <<<"$CHECK_SH" 2>&1)" || fail preflight "${why:-Проверка второго сервера не пройдена.}"
  peer_report '{"id":"peer"}' || fail preflight "Второй сервер не принимает отчёты: нет HA_SELF в .env или не запущен его мост."
}

# ---------- обычное переключение ----------
do_switch() {
  LOCAL_CREDS
  [[ -n "${HA_PEER_SSH:-}" && -n "${HA_VPS_SSH:-}" && -n "${HA_PEER_HOST:-}" ]] || fail preflight "Мост не настроен: нет HA_PEER_SSH, HA_PEER_HOST или HA_VPS_SSH (bridge.env)."
  local warn=""
  local names; names=$'\n'"$(docker ps --format '{{.Names}}' 2>/dev/null)"$'\n'
  [[ "$names" != *$'\nkppdf-backend\n'* ]] || fail preflight "CRM kppdf пишет на главном. Для согласованного переключения требуется отдельная остановка CRM."
  run_step preflight "$warn"
  assert_source preflight
  preflight_peer
  [[ "$(curl -s -m 5 -o /dev/null -w '%{http_code}' "$API/api/health/ready")" == 200 ]] || fail preflight "Этот сервер не готов (health)."

  # основной объём фото уходит ДО «только чтения»: внутри него остаётся короткая досинхронизация
  run_step photos_pre
  sync_photos "$T_PHOTOS" || fail photos_pre "Не удалось передать фото."

  assert_source readonly
  run_step readonly
  report "$ID" readonly running "" '"mode":"readonly"' || fail readonly "Не удалось включить режим «только чтение»."
  READONLY_AT=$(date +%s)
  sleep 5
  local before; before="$(counts_local)" || fail readonly "Не удалось посчитать записи на этом сервере."
  L "записей до: $before"

  run_step dump
  printf 'phase=restore\nkind=switch\nid=%s\n' "$ID" > "$CURRENT"
  RESTORE_STARTED=1   # с первого байта передачи сосед считается тронутым
  transfer_dump "${scope:-data}" || fail dump "Не удалось снять и передать базу."

  run_step restore
  apply_standby data readonly "$before" "$(cap "$T_RESTORE")"

  run_step photos
  sync_photos "$T_PHOTOS_RO" || fail photos "Не удалось досинхронизировать фото."

  run_step verify
  local after; after="$(counts_peer)" || fail verify "Не удалось посчитать записи на втором сервере."
  L "записей после: $after"
  [[ -n "$before" && "$before" == "$after" ]] || fail verify "Число записей не совпало: здесь $before, там $after."
  peer_health || fail verify "Второй сервер не отвечает на health."

  run_step promote
  assert_source promote
  peer "$T_SSH" "$(peer_vars)$(held_by_switch)" || fail promote "Захват запасного изменился перед повышением."
  peer_report "{\"id\":\"$ID\",\"step\":\"promote\",\"state\":\"running\",\"role\":\"main\",\"mode\":\"normal\"}" || fail promote "Второй сервер не стал главным."

  run_step vps
  assert_source vps
  peer "$T_SSH" "$(peer_vars)$(held_by_switch)" || fail vps "Захват запасного изменился перед переключением домена."
  printf 'phase=vps\nid=%s\n' "$ID" > "$CURRENT"   # домен может уже поменяться — до подтверждения откат решает `dc-switch status`
  vps "$PEER_NAME" >>"$LOG" 2>&1
  domain_now; case "$DOM" in
    "$PEER_NAME") ;;                                                     # домен у соседа — вперёд
    "$SELF") fail vps "VPS не переключил домен на $PEER_NAME. Домен остался на этом сервере." ;;
    *) L "VPS не подтвердил, где домен; откат не делаю, решит следующий цикл моста"; exit 1 ;;
  esac
  printf 'phase=switched\nid=%s\n' "$ID" > "$CURRENT"   # только после подтверждённой смены домена
  finish_switched
}

# ---------- обновить запасной (домен не трогаем) ----------
finish_refresh() {
  local ok=0 i
  for i in 1 2 3 4 5; do
    report "$ID" finish done "" '"mode":"normal"' && { ok=1; break; }
    sleep 10
  done
  [[ $ok == 1 ]] || { L "Финальный отчёт ждёт подтверждения в следующем цикле"; exit 1; }
  L "обновление $ID завершено: главный остался $SELF, домен не менялся"
  exit 0
}
do_refresh() {
  LOCAL_CREDS
  [[ -n "${HA_PEER_SSH:-}" && -n "${HA_PEER_HOST:-}" ]] || fail preflight "Мост не настроен: нет HA_PEER_SSH или HA_PEER_HOST (bridge.env)."
  local warn=""
  local names; names=$'\n'"$(docker ps --format '{{.Names}}' 2>/dev/null)"$'\n'
  [[ "$names" == *$'\nkppdf-backend\n'* ]] && warn="Предупреждение: CRM kppdf (kppdf-backend) запущена на этом сервере. Она не переключается и продолжит работать с этой базой."
  run_step preflight "$warn"
  assert_source preflight
  preflight_peer
  [[ "$(curl -s -m 5 -o /dev/null -w '%{http_code}' "$API/api/health/ready")" == 200 ]] || fail preflight "Этот сервер не готов (health)."

  local scope=data
  if [[ "$NOCODE" != 0 ]]; then
    scope=both
    run_step code
    prepare_code >>"$LOG" 2>&1 || fail code "Не удалось проверить архив принятого выпуска или собрать образ запасного."
  fi
  run_step photos_pre
  sync_photos "$T_PHOTOS" || fail photos_pre "Не удалось передать фото."

  assert_source readonly
  run_step readonly
  report "$ID" readonly running "" '"mode":"readonly"' || fail readonly "Не удалось включить режим «только чтение»."
  READONLY_AT=$(date +%s)
  sleep 5
  local before; before="$(counts_local)" || fail readonly "Не удалось посчитать записи на этом сервере."
  L "записей до: $before"

  run_step dump
  printf 'phase=restore\nkind=refresh\nid=%s\n' "$ID" > "$CURRENT"
  RESTORE_STARTED=1
  transfer_dump "${scope:-data}" || fail dump "Не удалось снять и передать базу."
  # Обновление идёт каждые 15 мин (C042-A3): запись на паузе только на время дампа (секунды), дальше главный снова пишет.
  # Сверка ниже сравнивает с числом записей «до», снятым под паузой, — копия соответствует дампу.
  assert_source dump
  report "$ID" dump running "" '"mode":"normal"' || fail dump "Не удалось вернуть запись на этом сервере."
  READONLY_AT=0

  run_step photos
  sync_photos "$T_PHOTOS_RO" || fail photos "Не удалось досинхронизировать фото."
  run_step restore
  apply_standby "$scope" normal "$before" "$((T_RESTORE * 3 + T_VERIFY + 120))"
  run_step verify
  peer "$T_SSH" "mkdir -p $(printf '%q' "$PEER_DATA")/switch && date -u +%Y-%m-%dT%H:%M:%SZ > $(printf '%q' "$PEER_DATA")/switch/last-refresh" \
    || fail verify "Не удалось записать время обновления на втором сервере."
  peer_info
  finish_refresh
}

# ---------- аварийный подъём ----------
do_emergency() {
  LOCAL_CREDS
  [[ -n "${HA_VPS_SSH:-}" ]] || fail preflight "Мост не настроен: нет HA_VPS_SSH (bridge.env)."
  run_step preflight
  { domain_now; [[ -n "$DOM" ]]; } || fail preflight "VPS не отвечает на dc-switch status: без него домен не переключить."
  # «основной мёртв» — по VPS: его туннель не отвечает (а не по ssh между серверами)
  [[ "$(route_health "$PEER_NAME")" == false ]] || fail preflight "Основной сервер отвечает на VPS. Используйте обычное переключение с него."
  # C045 🟡5: туннель лёг, а сам основной жив и пишет — это обрыв связи; второй главный дал бы две пишущие стороны
  if [[ -n "${HA_PEER_SSH:-}" ]] && peer_health; then fail preflight "Основной сервер жив (отвечает напрямую), не отвечает только связь с VPS. Это не авария: второй главный не включаю."; fi
  [[ "$(curl -s -m 5 -o /dev/null -w '%{http_code}' "$API/api/health/ready")" == 200 ]] || fail preflight "Этот сервер не готов (health)."
  run_step vps
  domain_now
  [[ "$DOM" == "$PEER_NAME" && "$(route_health "$PEER_NAME")" == false ]] || fail vps "Владелец домена или состояние основного сервера изменились."
  printf 'phase=emergency\nid=%s\n' "$ID" > "$CURRENT"
  vps "$SELF" >>"$LOG" 2>&1
  domain_now
  case "$DOM" in
    "$SELF") ;;
    "$PEER_NAME") fail vps "VPS не переключил домен на этот сервер." ;;
    *) L "После аварийного запроса владелец неизвестен. Проверку повторит следующий цикл."; exit 1 ;;
  esac
  local note="Цели копий вне дома на этом сервере выключены (это копия): включите нужные вручную в админке."
  local i ok=0
  for i in 1 2 3 4 5; do report "$ID" finish done "$note" '"role":"main","mode":"normal"' && { ok=1; break; }; sleep 10; done
  [[ $ok == 1 ]] || { L "Финальный отчёт ждёт подтверждения в следующем цикле"; exit 1; }
  L "аварийный подъём $ID завершён: главный — $SELF (на последних данных)"
  exit 0
}

# ---------- после падения моста посреди работы ----------
if [[ -f "$CURRENT" ]]; then
  PHASE="$(sed -n 's/^phase=//p' "$CURRENT" | head -n 1)"; ID="$(sed -n 's/^id=//p' "$CURRENT" | head -n 1)"; KIND="$(sed -n 's/^kind=//p' "$CURRENT" | head -n 1)"
  L "найдена прерванная работа $ID (фаза ${PHASE:-?})"
  # После остановки самого моста его собственный захват можно освободить под .lock.
  # Блокировка операции на принимающей стороне снимается только её процессом.
  if [[ "$(cat "$DC_DIR/.ha-operation/owner" 2>/dev/null)" == "bridge-$ID" ]]; then
    release_operation_lock "$DC_DIR" "bridge-$ID" || exit 1
  fi
  case "$PHASE" in
    terminal)
      BODY="$(sed -n 's/^body=//p' "$CURRENT")"
      [[ -n "$BODY" ]] || exit 1
      if terminal_report "$BODY"; then rm -f "$CURRENT"; fi ;;
    ownership)
      domain_now
      if [[ "$DOM" == "$SELF" ]]; then
        if [[ "$KIND" == switch ]]; then peer_cancel_switch || true; fi
        report "$ID" recovery failed "Операция остановлена. VPS подтвердил, что домен остался здесь."
      elif [[ "$DOM" == "$PEER_NAME" ]]; then
        report "$ID" recovery failed "Операция остановлена. Домен у соседа, этот сервер переведён в запасные." '"role":"standby","mode":"readonly"'
      fi ;;
    switched|vps)
      KIND=switch
      domain_now; case "$DOM" in
        "$PEER_NAME") finish_switched ;;
        "$SELF") peer_cancel_switch; report "$ID" recovery failed "Мост прерван, домен остался на этом сервере." ;;
        *) L "Владелец домена неизвестен, жду подтверждения"; exit 0 ;;
      esac ;;
    emergency)
      domain_now
      if [[ "$DOM" == "$SELF" ]]; then report "$ID" finish done "" '"role":"main","mode":"normal"'
      elif [[ "$DOM" == "$PEER_NAME" ]]; then report "$ID" recovery failed "Аварийный подъём прерван, домен у основного сервера."; fi ;;
    *)
      if [[ "$KIND" == switch ]]; then peer_cancel_switch || true; fi
      report "$ID" recovery failed "Мост был прерван. Проверьте состояние второго сервера перед повтором." ;;
  esac
  [[ ! -f "$CURRENT" ]] || exit 0
fi

# вернувшийся старый главный — каждый цикл, и при старте
self_guard

# ---------- заявка ----------
if [[ ! -e "$REQ" ]]; then
  # тихо: раз в PEER_INFO_EVERY секунд обновляем сведения о втором сервере для экрана
  STAMP="${SW_DIR}/peer-info.stamp"
  if [[ -n "${HA_PEER_SSH:-}" ]]; then
    last="$(stat -c %Y "$STAMP" 2>/dev/null || echo 0)"
    if (( $(date +%s) - last >= PEER_INFO_EVERY )); then touch "$STAMP"; peer_info; fi
  fi
  exit 0
fi

ID="$(sed -n 's/^id=//p' "$REQ" | head -n 1)"; KIND="$(sed -n 's/^kind=//p' "$REQ" | head -n 1)"; NOCODE="$(sed -n 's/^code=//p' "$REQ" | head -n 1)"
[[ "$ID" =~ ^[0-9a-f]{6,32}$ ]] || { L "заявка с неверным id отброшена"; rm -f "$REQ"; exit 0; }
LAST_ID_FILE="${SW_DIR}/last-id"
[[ "$(cat "$LAST_ID_FILE" 2>/dev/null)" != "$ID" ]] || { rm -f "$REQ"; exit 0; }
EXPIRES="$(sed -n 's/^expiresAt=//p' "$REQ" | head -n 1)"
printf 'phase=pre\nid=%s\nkind=%s\n' "$ID" "$KIND" > "$CURRENT.new" && mv -f "$CURRENT.new" "$CURRENT" || exit 1
printf '%s\n' "$ID" > "$LAST_ID_FILE" && rm -f "$REQ" || exit 1
L "=== заявка $ID ($KIND) на $SELF ==="
if [[ -n "$EXPIRES" ]]; then
  until_ts="$(date -u -d "$EXPIRES" +%s)" && (( $(date -u +%s) < until_ts )) || fail preflight "Разрешённое окно расписания закончилось."
fi
take_operation_lock "$DC_DIR" "bridge-$ID" || fail preflight "Сервер занят выкладкой или восстановлением."
trap 'release_operation_lock "$DC_DIR" "bridge-$ID"' EXIT
case "$KIND" in
  switch) do_switch ;;
  emergency) do_emergency ;;
  refresh) do_refresh ;;
  *) fail preflight "Неизвестный тип заявки." ;;
esac
exit $?
}
