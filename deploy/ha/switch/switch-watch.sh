#!/bin/bash
# switch-watch.sh — хост-мост «Переключить сейчас» (HA-TWO-SERVERS, SW-4/SW-5). По образцу bundle-watch.sh.
# Cron пользователя деплоя раз в минуту, на КАЖДОМ из двух серверов:
#   * * * * * DATA_DIR=/var/lib/datacore bash /opt/data-core/deploy/ha/switch/switch-watch.sh
# Контейнер backend сам ничего на хосте не запускает: кнопка в админке кладёт файл
#   ${DATA_DIR}/switch/request   (id=…, kind=switch|emergency)
# мост его подхватывает и по шагам докладывает серверу: POST /api/control/switch/report с секретом из файла
#   ${DATA_DIR}/switch/secret    (создаёт мост; секрет в аргументах и логах не светится).
# Идемпотентен: нет заявки — тихо выходит (раз в 5 минут обновляет сведения о втором сервере);
# уже работает другой экземпляр (flock) — тихо выходит. set -x НЕ использовать: читается .env с паролями.
#
# Настройки — в окружении cron или в ${DATA_DIR}/switch/bridge.env (его пишет SRV-ERP/setup-switch.sh):
#   HA_SELF                home|office (иначе из .env)         HA_PEER_SSH   user@host второго сервера
#   HA_PEER_PORT (22)      HA_PEER_KEY  ключ для передачи      HA_PEER_PROXY ProxyCommand (Sportin → VM через VPS :4222)
#   HA_PEER_DC_DIR (/opt/data-core)  HA_PEER_DATA (/var/lib/datacore)  HA_PEER_API (http://127.0.0.1:3001)
#   HA_VPS_SSH root@vps    HA_VPS_KEY  ключ ТОЛЬКО для dc-switch   HA_API (http://127.0.0.1:3001)
#   HA_COUNT_COLLS  коллекции для сверки (по умолчанию 5 главных)
# Порядок при kind=switch: проверка → readonly → дамп → передача → восстановление на втором (со страховочным дампом)
# → фото (rsync --ignore-existing) → сверка записей и health → второй главный → VPS (dc-switch) → этот standby+readonly.
# Любая ошибка ДО переключения домена: этот сервер снова пишет (mode=normal), домен не тронут, job=failed.
set -uo pipefail
umask 077

DATA_DIR="${DATA_DIR:-/var/lib/datacore}"
DC_DIR="${DC_DIR:-/opt/data-core}"
SW_DIR="${HA_SWITCH_DIR_HOST:-${DATA_DIR}/switch}"
mkdir -p "$SW_DIR"
# в каталоге пишет процесс из контейнера (другой uid): sticky-бит, как у /tmp (читает backend: secret, alive)
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
# таймауты шагов, секунд
T_SSH="${T_SSH:-30}"; T_DUMP="${T_DUMP:-1800}"; T_RESTORE="${T_RESTORE:-1800}"; T_PHOTOS="${T_PHOTOS:-3600}"
T_VERIFY="${T_VERIFY:-300}"; T_VPS="${T_VPS:-60}"; T_REPORT="${T_REPORT:-15}"
PEER_INFO_EVERY="${PEER_INFO_EVERY:-300}"

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
L() { printf '%s %s\n' "$(now)" "$*" >> "$LOG"; }
# строка → JSON-строка (без python/node на хосте)
jstr() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr '\t' ' ' | sed -e ':a;N;$!ba;s/\n/\\n/g'; }
envval() { grep -m1 "^$1=" "$DC_DIR/.env" 2>/dev/null | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'\$//"; }

: >> "$LOG"; chmod 600 "$LOG" 2>/dev/null || true
# лог не растёт бесконечно
if [[ $(wc -l < "$LOG") -gt 2000 ]]; then tail -n 1000 "$LOG" > "${LOG}.old" && mv -f "${LOG}.old" "$LOG"; fi

# секрет для отчётов: создаём один раз, читает и мост, и контейнер
if [[ ! -s "$SECRET_FILE" ]]; then
  head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n' > "${SECRET_FILE}.tmp" && chmod 644 "${SECRET_FILE}.tmp" && mv -f "${SECRET_FILE}.tmp" "$SECRET_FILE"
fi
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

# ---------- отчёты серверу ----------
post_report() {
  local hf code i; hf="$(mktemp)" || return 1
  printf 'X-Switch-Secret: %s\n' "$SECRET" > "$hf"
  for i in 1 2 3; do
    code="$(curl -sS -m "$T_REPORT" -o /dev/null -w '%{http_code}' -H @"$hf" -H 'Content-Type: application/json' -d "$1" "$API/api/control/switch/report" 2>>"$LOG")"
    [[ "$code" == 200 ]] && { rm -f "$hf"; return 0; }
    L "отчёт не принят (код ${code:-нет}), попытка $i"; sleep 3
  done
  rm -f "$hf"; return 1
}
# report ID STEP STATE [ERROR] [EXTRA-JSON-ФРАГМЕНТ]
report() {
  local b="{\"id\":\"$1\",\"step\":\"$2\",\"state\":\"$3\""
  [[ -n "${4:-}" ]] && b+=",\"error\":\"$(jstr "$4")\""
  [[ -n "${5:-}" ]] && b+=",$5"
  post_report "$b}"
}
# то же на втором сервере: его секрет читаем там же, тело идёт через stdin
PEER_REPORT_SH='S=$(cat "$PD/switch/secret") || exit 3; H=$(mktemp); printf "X-Switch-Secret: %s\n" "$S" > "$H"; B=$(cat); c=$(curl -sS -m 15 -o /dev/null -w "%{http_code}" -H @"$H" -H "Content-Type: application/json" -d "$B" "$PAPI/api/control/switch/report"); rm -f "$H"; [ "$c" = 200 ]'
peer_report() { printf '%s' "$1" | peer "$T_SSH" "PD=$(printf '%q' "$PEER_DATA") PAPI=$(printf '%q' "$PEER_API"); $PEER_REPORT_SH"; }

# ---------- Mongo ----------
LOCAL_CREDS() { MONGO_ROOT_USER="$(envval MONGO_ROOT_USER)"; MONGO_ROOT_PASSWORD="$(envval MONGO_ROOT_PASSWORD)"; MONGO_ROOT_USER="${MONGO_ROOT_USER:-root}"; }
COUNTS_SH='docker exec datacore-mongo sh -c '"'"'mongo --quiet -u "$0" -p "$1" --authenticationDatabase admin datacore --eval "var cs=\"$2\".split(\" \"); print(cs.map(function(c){return c+\"=\"+db.getCollection(c).count()}).join(\",\"))"'"'"' "$MONGO_ROOT_USER" "$MONGO_ROOT_PASSWORD" "$COLLS"'
counts_local() { COLLS="$COLLS" MONGO_ROOT_USER="$MONGO_ROOT_USER" MONGO_ROOT_PASSWORD="$MONGO_ROOT_PASSWORD" timeout "$T_VERIFY" bash -c "$COUNTS_SH"; }
counts_peer() { peer "$T_VERIFY" "cd $(printf '%q' "$PEER_DC") && set -a && . ./.env && set +a && COLLS=$(printf '%q' "$COLLS"); $COUNTS_SH"; }
dump_local() { timeout "$T_DUMP" docker exec datacore-mongo sh -c 'mongodump --quiet -u "$0" -p "$1" --authenticationDatabase admin --db datacore --archive --gzip' "$MONGO_ROOT_USER" "$MONGO_ROOT_PASSWORD"; }

# выполняется НА втором сервере: страховочный дамп, остановка backend, восстановление, запуск, ожидание health
RESTORE_SH='set -uo pipefail
cd "$DC" && set -a && . ./.env && set +a || exit 10
B="$PD/switch"; F="$B/incoming.archive.gz"
gzip -t "$F" || { echo "архив повреждён"; exit 11; }
docker exec datacore-mongo sh -c '"'"'mongodump --quiet -u "$0" -p "$1" --authenticationDatabase admin --db datacore --archive --gzip'"'"' "$MONGO_ROOT_USER" "$MONGO_ROOT_PASSWORD" > "$B/before-switch.archive.gz" || { echo "страховочный дамп не снят"; exit 12; }
docker stop datacore-backend >/dev/null 2>&1
docker exec -i datacore-mongo sh -c '"'"'mongorestore --quiet -u "$0" -p "$1" --authenticationDatabase admin --drop --archive --gzip --nsInclude "datacore.*"'"'"' "$MONGO_ROOT_USER" "$MONGO_ROOT_PASSWORD" < "$F" || { echo "восстановление не удалось"; docker start datacore-backend >/dev/null 2>&1; exit 13; }
docker start datacore-backend >/dev/null 2>&1
for i in $(seq 1 60); do
  [ "$(curl -s -m 3 -o /dev/null -w "%{http_code}" "$PAPI/api/health/ready")" = 200 ] && { rm -f "$F"; exit 0; }
  sleep 3
done
echo "backend не поднялся"; exit 14'

peer_health() { [[ "$(peer "$T_SSH" "curl -s -m 5 -o /dev/null -w '%{http_code}' $(printf '%q' "$PEER_API")/api/health/ready" 2>/dev/null)" == 200 ]]; }
version_of() { sed -n 's/.*"version"[^"]*"\([^"]*\)".*/\1/p' | head -n 1 | head -c 60; }

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

# ---------- провал и откат ----------
ID=""; KIND=""; READONLY_ON=0; PEER_PROMOTED=0
fail() {   # fail STEP "понятная причина"
  L "ОШИБКА [$1]: $2"
  if [[ $PEER_PROMOTED == 1 ]]; then
    peer_report "{\"id\":\"$ID\",\"step\":\"rollback\",\"state\":\"running\",\"role\":\"standby\",\"mode\":\"readonly\"}" || L "не удалось вернуть второй сервер в запасные"
  fi
  # backend на втором мог остаться остановленным после сорванного восстановления
  peer "$T_SSH" "docker start datacore-backend >/dev/null 2>&1; true" >/dev/null 2>&1 || true
  report "$ID" "$1" failed "$2" || L "отчёт о провале не доставлен; сервер снимет «только чтение» сам через 90 минут"
  rm -f "$CURRENT"
  exit 1
}

run_step() {   # run_step ID STEP — сообщить о шаге
  L "шаг: $1"; report "$ID" "$1" running || fail "$1" "Сервер не принял отчёт моста. Проверьте секрет и HA_SELF."
}

# ---------- обычное переключение ----------
do_switch() {
  LOCAL_CREDS
  [[ -n "${HA_PEER_SSH:-}" && -n "${HA_VPS_SSH:-}" ]] || fail preflight "Мост не настроен: нет HA_PEER_SSH или HA_VPS_SSH (bridge.env)."
  run_step preflight
  peer "$T_SSH" 'echo ok' >/dev/null 2>&1 || fail preflight "Второй сервер недоступен по ssh."
  command -v rsync >/dev/null 2>&1 || fail preflight "На этом сервере нет rsync."
  peer "$T_SSH" 'command -v rsync >/dev/null' >/dev/null 2>&1 || fail preflight "На втором сервере нет rsync."
  [[ "$(peer "$T_SSH" 'docker inspect -f "{{.State.Running}}" datacore-mongo 2>/dev/null')" == true ]] || fail preflight "На втором сервере не запущена база (datacore-mongo)."
  local free; free="$(peer "$T_SSH" "df --output=avail -k $(printf '%q' "$PEER_DATA") | tail -n 1" 2>/dev/null | tr -dc 0-9)"
  [[ -n "$free" && "$free" -gt 1048576 ]] || fail preflight "На втором сервере меньше 1 ГБ свободного места."
  peer "$T_SSH" "mkdir -p $(printf '%q' "$PEER_DATA")/switch" >/dev/null 2>&1 || fail preflight "На втором сервере нельзя создать папку переключения."
  peer_report '{"id":"peer","peer":{"healthy":true}}' || fail preflight "Второй сервер не принимает отчёты: нет HA_SELF в .env или не запущен его мост."
  [[ "$(vps status 2>/dev/null)" == *domain=* ]] || fail preflight "VPS не отвечает на dc-switch status (ключ или команда)."
  [[ "$(curl -s -m 5 -o /dev/null -w '%{http_code}' "$API/api/health/ready")" == 200 ]] || fail preflight "Этот сервер не готов (health)."

  run_step readonly
  # сначала только чтение, потом сверка: дальше данные не меняются
  READONLY_ON=1
  report "$ID" readonly running "" '"mode":"readonly"' || fail readonly "Не удалось включить режим «только чтение»."
  sleep 5
  local before; before="$(counts_local)" || fail readonly "Не удалось посчитать записи на этом сервере."
  L "записей до: $before"

  run_step dump
  dump_local | peer "$T_DUMP" "cat > $(printf '%q' "$PEER_DATA")/switch/incoming.archive.gz" || fail dump "Не удалось снять и передать базу."

  run_step restore
  peer "$T_RESTORE" "DC=$(printf '%q' "$PEER_DC") PD=$(printf '%q' "$PEER_DATA") PAPI=$(printf '%q' "$PEER_API"); $RESTORE_SH" >>"$LOG" 2>&1 \
    || fail restore "Восстановление на втором сервере не удалось (страховочная копия — switch/before-switch.archive.gz на нём)."

  run_step photos
  timeout "$T_PHOTOS" rsync -rt --ignore-existing --partial -e "$RSH" "${DATA_DIR}/uploads/" "${HA_PEER_SSH}:${PEER_DATA}/uploads/" >>"$LOG" 2>&1 \
    || fail photos "Не удалось передать новые фото."

  run_step verify
  local after; after="$(counts_peer)" || fail verify "Не удалось посчитать записи на втором сервере."
  L "записей после: $after"
  [[ -n "$before" && "$before" == "$after" ]] || fail verify "Число записей не совпало: здесь $before, там $after."
  peer_health || fail verify "Второй сервер не отвечает на health."

  run_step promote
  peer_report "{\"id\":\"$ID\",\"step\":\"promote\",\"state\":\"running\",\"role\":\"main\",\"mode\":\"normal\"}" || fail promote "Второй сервер не стал главным."
  PEER_PROMOTED=1

  run_step vps
  printf 'phase=switched\nid=%s\n' "$ID" > "$CURRENT"   # после этой точки откат невозможен
  if ! vps "$PEER_NAME" >>"$LOG" 2>&1; then
    rm -f "$CURRENT"; fail vps "VPS не переключил домен на $PEER_NAME. Домен остался на этом сервере."
  fi
  finish_switched
}

# финал после успешного переключения домена; повторяем отчёты, домен уже у соседа
finish_switched() {
  local ok=0 i
  peer_report "{\"id\":\"$ID\",\"step\":\"finish\",\"state\":\"done\",\"role\":\"main\",\"mode\":\"normal\"}" >/dev/null 2>&1 || L "второй сервер: финальный отчёт не принят"
  for i in 1 2 3 4 5; do
    report "$ID" finish done "" '"role":"standby","mode":"readonly"' && { ok=1; break; }
    sleep 10
  done
  [[ $ok == 1 ]] || L "финальный отчёт не доставлен; проверьте состояние в админке"
  rm -f "$CURRENT"
  L "переключение $ID завершено: главный — $PEER_NAME"
  exit 0
}

# ---------- аварийный подъём ----------
do_emergency() {
  [[ -n "${HA_VPS_SSH:-}" ]] || fail preflight "Мост не настроен: нет HA_VPS_SSH (bridge.env)."
  run_step preflight
  if [[ -n "${HA_PEER_SSH:-}" ]] && peer_health; then
    fail preflight "Основной сервер отвечает. Используйте обычное переключение с него."
  fi
  [[ "$(curl -s -m 5 -o /dev/null -w '%{http_code}' "$API/api/health/ready")" == 200 ]] || fail preflight "Этот сервер не готов (health)."
  run_step vps
  printf 'phase=emergency\nid=%s\n' "$ID" > "$CURRENT"
  vps "$SELF" >>"$LOG" 2>&1 || { rm -f "$CURRENT"; fail vps "VPS не переключил домен на этот сервер."; }
  local i ok=0
  for i in 1 2 3 4 5; do report "$ID" finish done "" '"role":"main","mode":"normal"' && { ok=1; break; }; sleep 10; done
  [[ $ok == 1 ]] || L "финальный отчёт не доставлен"
  rm -f "$CURRENT"
  L "аварийный подъём $ID завершён: главный — $SELF (на последних данных)"
  exit 0
}

# ---------- после падения моста посреди работы ----------
if [[ -f "$CURRENT" ]]; then
  PHASE="$(sed -n 's/^phase=//p' "$CURRENT" | head -n 1)"; ID="$(sed -n 's/^id=//p' "$CURRENT" | head -n 1)"
  L "найдена прерванная работа $ID (фаза ${PHASE:-?})"
  if [[ "$PHASE" == switched && -n "${HA_PEER_SSH:-}" ]]; then
    # домен уже у соседа: достраиваем финал
    finish_switched
  elif [[ "$PHASE" == emergency ]]; then
    report "$ID" finish done "" '"role":"main","mode":"normal"' && rm -f "$CURRENT"
  else
    [[ -n "$ID" ]] && report "$ID" recovery failed "Мост был прерван до переключения домена. Домен не менялся."
    peer "$T_SSH" "docker start datacore-backend >/dev/null 2>&1; true" >/dev/null 2>&1 || true
    rm -f "$CURRENT"
  fi
fi

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
