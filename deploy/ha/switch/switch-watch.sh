#!/bin/bash
# switch-watch.sh — хост-мост «Переключить сейчас» (HA-TWO-SERVERS, SW-4/SW-5). По образцу bundle-watch.sh.
# Cron пользователя деплоя раз в минуту, на КАЖДОМ из двух серверов:
#   * * * * * DATA_DIR=/var/lib/datacore bash /opt/data-core/deploy/ha/switch/switch-watch.sh
# Контейнер backend сам ничего на хосте не запускает: кнопка в админке кладёт файл
#   ${DATA_DIR}/switch/request   (id=…, kind=switch|emergency)
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
# Любая ошибка ДО подтверждённой смены домена: этот сервер снова пишет (mode=normal), домен не тронут, сосед снова standby.
# Каждый цикл: если домен у соседа, а этот сервер всё ещё main (вернулся старый главный) — он сам становится standby/readonly.
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
T_VERIFY="${T_VERIFY:-120}"; T_VPS="${T_VPS:-60}"; T_REPORT="${T_REPORT:-15}"
RO_BUDGET="${RO_BUDGET:-600}"
PEER_INFO_EVERY="${PEER_INFO_EVERY:-300}"

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
LAST_REPLY=""
post_report() {
  local hf rf code i; hf="$(mktemp)" || return 1; rf="$(mktemp)" || return 1
  printf 'X-Switch-Secret: %s\n' "$SECRET" > "$hf"
  for i in 1 2 3; do
    code="$(curl -sS -m "$T_REPORT" -o "$rf" -w '%{http_code}' -H @"$hf" -H 'Content-Type: application/json' -d "$1" "$API/api/control/switch/report" 2>>"$LOG")"
    [[ "$code" == 200 ]] && { LAST_REPLY="$(cat "$rf")"; rm -f "$hf" "$rf"; return 0; }
    L "отчёт не принят (код ${code:-нет}), попытка $i"; sleep 3
  done
  rm -f "$hf" "$rf"; return 1
}
# report ID STEP STATE [ПРЕДУПРЕЖДЕНИЕ/ОШИБКА] [EXTRA-JSON-ФРАГМЕНТ]
report() {
  local b="{\"id\":\"$1\",\"step\":\"$2\",\"state\":\"$3\""
  [[ -n "${4:-}" ]] && b+=",\"error\":\"$(jstr "$4")\""
  [[ -n "${5:-}" ]] && b+=",$5"
  post_report "$b}"
}
# то же на втором сервере: его секрет читаем там же, тело идёт через stdin
PEER_REPORT_SH='S=$(cat "$PD/switch/secret") || exit 3; H=$(mktemp); printf "X-Switch-Secret: %s\n" "$S" > "$H"; B=$(cat); c=$(curl -sS -m 15 -o /dev/null -w "%{http_code}" -H @"$H" -H "Content-Type: application/json" -d "$B" "$PAPI/api/control/switch/report"); rm -f "$H"; [ "$c" = 200 ]'
peer_report() { printf '%s' "$1" | peer "$T_SSH" "$(peer_vars)$PEER_REPORT_SH"; }

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
R=$(docker exec -e MONGO_ROOT_USER -e MONGO_ROOT_PASSWORD datacore-mongo sh -c 'mongo --quiet -u "$MONGO_ROOT_USER" -p "$MONGO_ROOT_PASSWORD" --authenticationDatabase admin datacore --eval "var d=db.app_control_state.findOne({_id:\"switch\"}); print(d?d.role:\"\")"' 2>/dev/null | tr -d '[:space:]')
[ "$R" = standby ] || { echo "Второй сервер не запасной (role=${R:-нет}). Восстановление отменено."; exit 23; }
E
read -r -d '' DEMOTE_SH <<'E'
docker exec -e MONGO_ROOT_USER -e MONGO_ROOT_PASSWORD datacore-mongo sh -c 'mongo --quiet -u "$MONGO_ROOT_USER" -p "$MONGO_ROOT_PASSWORD" --authenticationDatabase admin datacore --eval "db.app_control_state.updateOne({_id:\"switch\"},{\$set:{role:\"standby\",mode:\"readonly\"}})"' >/dev/null
E
read -r -d '' RESTORE_BODY <<'E'
B="$PD/switch"; F="$B/incoming.archive.gz"; TS=$(date +%Y%m%d%H%M%S)
gzip -t "$F" || { echo "архив повреждён"; exit 11; }
docker exec -e MONGO_ROOT_USER -e MONGO_ROOT_PASSWORD datacore-mongo sh -c 'mongodump --quiet -u "$MONGO_ROOT_USER" -p "$MONGO_ROOT_PASSWORD" --authenticationDatabase admin --db datacore --archive --gzip' > "$B/before-switch-$TS.archive.gz" || { echo "страховочный дамп не снят"; rm -f "$B/before-switch-$TS.archive.gz"; exit 12; }
ls -1t "$B"/before-switch-*.archive.gz 2>/dev/null | tail -n +4 | xargs -r rm -f
docker stop datacore-backend >/dev/null 2>&1
if ! docker exec -i -e MONGO_ROOT_USER -e MONGO_ROOT_PASSWORD datacore-mongo sh -c 'mongorestore --quiet -u "$MONGO_ROOT_USER" -p "$MONGO_ROOT_PASSWORD" --authenticationDatabase admin --drop --archive --gzip --nsInclude "datacore.*"' < "$F"; then
  echo "восстановление не удалось"; eval "$DEMOTE_CMD"; docker start datacore-backend >/dev/null 2>&1; exit 13
fi
eval "$DEMOTE_CMD"   # дамп принёс role=main: сосед остаётся запасным, пока мост не повысит его
docker start datacore-backend >/dev/null 2>&1
for i in $(seq 1 60); do
  [ "$(curl -s -m 3 -o /dev/null -w "%{http_code}" "$PAPI/api/health/ready")" = 200 ] && { rm -f "$F"; exit 0; }
  sleep 3
done
echo "backend не поднялся"; exit 14
E
DEMOTE_SH="${DEMOTE_SH%$'\n'}"   # одна строка: printf %q тогда даёт запись, понятную любой оболочке
RESTORE_SH="$CHECK_SH"$'\n'"$RESTORE_BODY"

peer_health() { [[ "$(peer "$T_SSH" "curl -s -m 5 -o /dev/null -w '%{http_code}' $(printf '%q' "$PEER_API")/api/health/ready" 2>/dev/null)" == 200 ]]; }
version_of() { sed -n 's/.*"version"[^"]*"\([^"]*\)".*/\1/p' | head -n 1 | head -c 60; }
# сосед снова запасной (и backend запущен) — после сорванного восстановления / отката
peer_demote() {
  [[ -n "${HA_PEER_SSH:-}" ]] || return 0
  peer "$T_SSH" "$(peer_vars)cd \"\$DC\" && set -a && . ./.env && set +a; $DEMOTE_SH; docker start datacore-backend >/dev/null 2>&1; true" >>"$LOG" 2>&1 || L "не удалось вернуть второй сервер в запасные"
}

# сведения о втором сервере для экрана: версия, возраст копии, health
peer_info() {
  local ver="" copy="" healthy=false x
  if peer_health; then
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
  VPS_STATUS="$(vps status 2>/dev/null)" || VPS_STATUS=""
  DOM="$(sed -n 's/^domain=\([a-z]*\).*/\1/p' <<<"$VPS_STATUS" | head -n 1)"
  [[ "$DOM" == home || "$DOM" == office ]] || DOM=""
  return 0
}
# вернувшийся старый главный: домен не у нас, а мы всё ещё main → сами становимся standby/readonly
self_guard() {
  [[ -n "${HA_VPS_SSH:-}" ]] || return 0
  domain_now; local dom="$DOM"
  [[ -n "$dom" && "$dom" != "$SELF" ]] || return 0
  post_report '{"id":"peer"}' || return 0
  [[ "$LAST_REPLY" == *'"role":"main"'* ]] || return 0
  L "домен у $dom, а этот сервер main: становлюсь запасным (только чтение)"
  post_report '{"id":"self","role":"standby","mode":"readonly"}' || L "не удалось стать запасным: идёт работа?"
}

# ---------- бюджет «только чтения» ----------
READONLY_AT=0
left() { echo $(( RO_BUDGET - ($(date +%s) - READONLY_AT) )); }
# таймаут шага не больше оставшегося бюджета (минимум 1 с)
cap() { local l; l=$(left); (( READONLY_AT == 0 )) && { echo "$1"; return; }; (( l < 1 )) && l=1; (( $1 < l )) && echo "$1" || echo "$l"; }
check_budget() { (( READONLY_AT == 0 )) || [[ $(left) -gt 0 ]] || fail "$1" "Больше 10 минут в режиме «только чтение»: переключение отменено, сайт снова пишет."; }

# ---------- провал и откат ----------
ID=""; KIND=""; RESTORE_STARTED=0
fail() {   # fail STEP "понятная причина"; вызывается, только когда домен точно НЕ у соседа
  L "ОШИБКА [$1]: $2"
  if [[ $RESTORE_STARTED == 1 ]]; then peer_demote
  else peer "$T_SSH" "docker start datacore-backend >/dev/null 2>&1; true" >/dev/null 2>&1 || true; fi
  report "$ID" "$1" failed "$2" || L "отчёт о провале не доставлен; сервер снимет «только чтение» сам, когда мост перестанет отвечать"
  rm -f "$CURRENT"
  exit 1
}

run_step() {   # run_step STEP [ПРЕДУПРЕЖДЕНИЕ] — сообщить о шаге
  L "шаг: $1"; check_budget "$1"
  report "$ID" "$1" running "${2:-}" || fail "$1" "Сервер не принял отчёт моста. Проверьте секрет и HA_SELF."
}
sync_photos() { timeout "$(cap "$1")" rsync -rt --ignore-existing --partial -e "$RSH" "${DATA_DIR}/uploads/" "${HA_PEER_SSH}:${PEER_DATA}/uploads/" >>"$LOG" 2>&1; }

# после подтверждённой смены домена: сосед главный, здесь цели копий выключаем, роль здесь standby+readonly
finish_switched() {
  LOCAL_CREDS
  local ok=0 i note=""
  peer_report "{\"id\":\"$ID\",\"step\":\"finish\",\"state\":\"done\",\"role\":\"main\",\"mode\":\"normal\"}" >/dev/null 2>&1 || L "второй сервер: финальный отчёт не принят"
  if ! targets_off; then note="Цели копий вне дома на этом сервере выключить не удалось: выключите вручную в админке."; L "$note"; fi
  for i in 1 2 3 4 5; do
    report "$ID" finish done "$note" '"role":"standby","mode":"readonly"' && { ok=1; break; }
    sleep 10
  done
  [[ $ok == 1 ]] || L "финальный отчёт не доставлен; проверьте состояние в админке"
  rm -f "$CURRENT"
  L "переключение $ID завершено: главный — $PEER_NAME"
  exit 0
}

# ---------- обычное переключение ----------
do_switch() {
  LOCAL_CREDS
  [[ -n "${HA_PEER_SSH:-}" && -n "${HA_VPS_SSH:-}" && -n "${HA_PEER_HOST:-}" ]] || fail preflight "Мост не настроен: нет HA_PEER_SSH, HA_PEER_HOST или HA_VPS_SSH (bridge.env)."
  local warn=""
  # CRM kppdf работает с той же базой напрямую и при переключении не переезжает — предупреждаем, решение за пользователем
  local names; names=$'\n'"$(docker ps --format '{{.Names}}' 2>/dev/null)"$'\n'
  [[ "$names" == *$'\nkppdf-backend\n'* ]] && warn="Предупреждение: CRM kppdf (kppdf-backend) запущена на этом сервере. Она не переключается и продолжит работать с этой базой."
  run_step preflight "$warn"
  peer "$T_SSH" 'echo ok' >/dev/null 2>&1 || fail preflight "Второй сервер недоступен по ssh."
  command -v rsync >/dev/null 2>&1 || fail preflight "На этом сервере нет rsync."
  peer "$T_SSH" 'command -v rsync >/dev/null' >/dev/null 2>&1 || fail preflight "На втором сервере нет rsync."
  [[ "$(peer "$T_SSH" 'docker inspect -f "{{.State.Running}}" datacore-mongo 2>/dev/null')" == true ]] || fail preflight "На втором сервере не запущена база (datacore-mongo)."
  local free; free="$(peer "$T_SSH" "df --output=avail -k $(printf '%q' "$PEER_DATA") | tail -n 1" 2>/dev/null | tr -dc 0-9)"
  [[ -n "$free" && "$free" -gt 1048576 ]] || fail preflight "На втором сервере меньше 1 ГБ свободного места."
  peer "$T_SSH" "mkdir -p $(printf '%q' "$PEER_DATA")/switch" >/dev/null 2>&1 || fail preflight "На втором сервере нельзя создать папку переключения."
  local why; why="$(peer "$T_SSH" "$(peer_vars)$CHECK_SH" 2>&1)" || fail preflight "${why:-Проверка второго сервера не пройдена.}"
  peer_report '{"id":"peer","peer":{"healthy":true}}' || fail preflight "Второй сервер не принимает отчёты: нет HA_SELF в .env или не запущен его мост."
  { domain_now; [[ -n "$DOM" ]]; } || fail preflight "VPS не отвечает на dc-switch status (ключ или команда)."
  [[ "$(curl -s -m 5 -o /dev/null -w '%{http_code}' "$API/api/health/ready")" == 200 ]] || fail preflight "Этот сервер не готов (health)."

  # основной объём фото уходит ДО «только чтения»: внутри него остаётся короткая досинхронизация
  run_step photos_pre
  sync_photos "$T_PHOTOS" || fail photos_pre "Не удалось передать фото."

  run_step readonly
  report "$ID" readonly running "" '"mode":"readonly"' || fail readonly "Не удалось включить режим «только чтение»."
  READONLY_AT=$(date +%s)
  sleep 5
  local before; before="$(counts_local)" || fail readonly "Не удалось посчитать записи на этом сервере."
  L "записей до: $before"

  run_step dump
  printf 'phase=restore\nid=%s\n' "$ID" > "$CURRENT"
  RESTORE_STARTED=1   # с первого байта передачи сосед считается тронутым
  dump_local | peer "$(cap "$T_DUMP")" "cat > $(printf '%q' "$PEER_DATA")/switch/incoming.archive.gz" || fail dump "Не удалось снять и передать базу."

  run_step restore
  peer "$(cap "$T_RESTORE")" "$(peer_vars)DEMOTE_CMD=$(printf '%q' "$DEMOTE_SH"); $RESTORE_SH" >>"$LOG" 2>&1 \
    || fail restore "Восстановление на втором сервере не удалось (страховочные копии — switch/before-switch-*.archive.gz на нём)."

  run_step photos
  sync_photos "$T_PHOTOS_RO" || fail photos "Не удалось досинхронизировать фото."

  run_step verify
  local after; after="$(counts_peer)" || fail verify "Не удалось посчитать записи на втором сервере."
  L "записей после: $after"
  [[ -n "$before" && "$before" == "$after" ]] || fail verify "Число записей не совпало: здесь $before, там $after."
  peer_health || fail verify "Второй сервер не отвечает на health."

  run_step promote
  peer_report "{\"id\":\"$ID\",\"step\":\"promote\",\"state\":\"running\",\"role\":\"main\",\"mode\":\"normal\"}" || fail promote "Второй сервер не стал главным."

  run_step vps
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

# ---------- аварийный подъём ----------
do_emergency() {
  LOCAL_CREDS
  [[ -n "${HA_VPS_SSH:-}" ]] || fail preflight "Мост не настроен: нет HA_VPS_SSH (bridge.env)."
  run_step preflight
  { domain_now; [[ -n "$DOM" ]]; } || fail preflight "VPS не отвечает на dc-switch status: без него домен не переключить."
  # «основной мёртв» — по VPS: его туннель не отвечает (а не по ssh между серверами)
  [[ "$VPS_STATUS" != *"${PEER_NAME}=up"* ]] || fail preflight "Основной сервер отвечает на VPS. Используйте обычное переключение с него."
  [[ "$(curl -s -m 5 -o /dev/null -w '%{http_code}' "$API/api/health/ready")" == 200 ]] || fail preflight "Этот сервер не готов (health)."
  run_step vps
  printf 'phase=emergency\nid=%s\n' "$ID" > "$CURRENT"
  vps "$SELF" >>"$LOG" 2>&1
  { domain_now; [[ "$DOM" == "$SELF" ]]; } || { rm -f "$CURRENT"; fail vps "VPS не переключил домен на этот сервер."; }
  local note="Цели копий вне дома на этом сервере выключены (это копия): включите нужные вручную в админке."
  local i ok=0
  for i in 1 2 3 4 5; do report "$ID" finish done "$note" '"role":"main","mode":"normal"' && { ok=1; break; }; sleep 10; done
  [[ $ok == 1 ]] || L "финальный отчёт не доставлен"
  rm -f "$CURRENT"
  L "аварийный подъём $ID завершён: главный — $SELF (на последних данных)"
  exit 0
}

# ---------- после падения моста посреди работы ----------
if [[ -f "$CURRENT" ]]; then
  PHASE="$(sed -n 's/^phase=//p' "$CURRENT" | head -n 1)"; ID="$(sed -n 's/^id=//p' "$CURRENT" | head -n 1)"
  L "найдена прерванная работа $ID (фаза ${PHASE:-?})"
  case "$PHASE" in
    switched) finish_switched ;;
    vps)
      domain_now; case "$DOM" in
        "$PEER_NAME") printf 'phase=switched\nid=%s\n' "$ID" > "$CURRENT"; finish_switched ;;
        "$SELF") peer_demote; report "$ID" recovery failed "Мост был прерван на смене домена. Домен остался на этом сервере."; rm -f "$CURRENT" ;;
        *) L "VPS не подтвердил, где домен; жду следующего цикла"; exit 0 ;;
      esac ;;
    emergency)
      if { domain_now; [[ "$DOM" == "$SELF" ]]; }; then report "$ID" finish done "" '"role":"main","mode":"normal"' && rm -f "$CURRENT"
      else report "$ID" recovery failed "Аварийный подъём прерван, домен не у этого сервера."; rm -f "$CURRENT"; fi ;;
    restore) peer_demote; [[ -n "$ID" ]] && report "$ID" recovery failed "Мост был прерван во время передачи. Домен не менялся."; rm -f "$CURRENT" ;;
    *) peer "$T_SSH" "docker start datacore-backend >/dev/null 2>&1; true" >/dev/null 2>&1 || true
       [[ -n "$ID" ]] && report "$ID" recovery failed "Мост был прерван до переключения домена. Домен не менялся."; rm -f "$CURRENT" ;;
  esac
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

ID="$(sed -n 's/^id=//p' "$REQ" | head -n 1)"; KIND="$(sed -n 's/^kind=//p' "$REQ" | head -n 1)"
rm -f "$REQ"
[[ "$ID" =~ ^[0-9a-f]{6,32}$ ]] || { L "заявка с неверным id отброшена"; exit 0; }
L "=== заявка $ID ($KIND) на $SELF ==="
printf 'phase=pre\nid=%s\n' "$ID" > "$CURRENT"
case "$KIND" in
  switch) do_switch ;;
  emergency) do_emergency ;;
  *) fail preflight "Неизвестный тип заявки." ;;
esac
