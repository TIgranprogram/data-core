#!/bin/bash
# dc-switch — переключатель домена на VPS (HA-TWO-SERVERS, SW-3). Ставится в /usr/local/bin/dc-switch.
#   dc-switch home|office|status
# home → upstream 127.0.0.1:4201 (туннель к домашней VM), office → 127.0.0.1:4203 (туннель к Sportin).
# Вызывается по ssh с ограниченного ключа: authorized_keys → command="/usr/local/bin/dc-switch",restrict ...
# Тогда слово приходит в SSH_ORIGINAL_COMMAND. Любое другое слово — отказ. Меняет ТОЛЬКО /etc/nginx/datacore-upstream.conf.
# Файл: upstream datacore_db { server 127.0.0.1:<порт>; } — подключён include'ом в блоке kppdf-proxy (SRV-ERP/setup-switch.sh).
# Порядок: порт цели отвечает health → пишем новый файл → nginx -t → reload; любая ошибка — старый файл возвращается.
# Переменные для проверки без реального nginx: DC_UPSTREAM_CONF, NGINX_BIN, CURL_BIN, DC_SWITCH_LOCK, DC_SWITCH_LOG.
set -uo pipefail
umask 022

CONF="${DC_UPSTREAM_CONF:-/etc/nginx/datacore-upstream.conf}"
NGINX="${NGINX_BIN:-nginx}"
CURL="${CURL_BIN:-curl}"
LOCK="${DC_SWITCH_LOCK:-/run/dc-switch.lock}"
LOG="${DC_SWITCH_LOG:-/var/log/dc-switch.log}"
PORT_HOME=4201
PORT_OFFICE=4203

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$LOG" 2>/dev/null || true; }
say() { printf '%s\n' "$*"; }

ARG="${1:-${SSH_ORIGINAL_COMMAND:-}}"
case "$ARG" in
  home)   NAME=home;   PORT=$PORT_HOME ;;
  office) NAME=office; PORT=$PORT_OFFICE ;;
  status) NAME=status ;;
  *) say "Использование: dc-switch home|office|status"; exit 2 ;;
esac

current_port() { sed -n 's/.*server 127\.0\.0\.1:\([0-9]*\);.*/\1/p' "$CONF" 2>/dev/null | head -n 1; }
health() { [[ "$("$CURL" -s -m 5 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$1/api/health/ready" 2>/dev/null)" == "200" ]]; }
name_of() { case "$1" in "$PORT_HOME") echo home ;; "$PORT_OFFICE") echo office ;; *) echo unknown ;; esac; }

if [[ "$NAME" == "status" ]]; then
  P="$(current_port)"
  say "domain=$(name_of "${P:-0}") port=${P:-none}"
  for pair in "home:$PORT_HOME" "office:$PORT_OFFICE"; do
    n="${pair%%:*}"; p="${pair##*:}"
    if health "$p"; then say "$n=up"; else say "$n=down"; fi
  done
  exit 0
fi

exec 9>"$LOCK" 2>/dev/null || { say "СТОП: нет доступа к замку $LOCK"; exit 5; }
flock -n 9 || { say "СТОП: переключение уже идёт"; exit 5; }

OLD="$(current_port)"
if [[ "$OLD" == "$PORT" ]]; then
  say "ok: домен уже на $NAME (порт $PORT)"
  exit 0
fi

# не переключаем домен на мёртвую цель
if ! health "$PORT"; then
  say "СТОП: $NAME не отвечает на порту $PORT. Домен не менялся."
  log "отказ: $NAME ($PORT) не отвечает"
  exit 3
fi

BAK=""
if [[ -f "$CONF" ]]; then BAK="${CONF}.prev"; cp -p "$CONF" "$BAK"; fi
rollback() {
  if [[ -n "$BAK" ]]; then cp -p "$BAK" "$CONF"; else rm -f "$CONF"; fi
  "$NGINX" -t >/dev/null 2>&1 && "$NGINX" -s reload >/dev/null 2>&1 || true
}

TMP="$(mktemp "${CONF}.XXXXXX")" || { say "СТОП: нельзя создать временный файл"; exit 4; }
printf '# управляется dc-switch; руками не править\nupstream datacore_db { server 127.0.0.1:%s; }\n' "$PORT" > "$TMP"
chmod 644 "$TMP"
mv -f "$TMP" "$CONF"

if ! "$NGINX" -t >/dev/null 2>&1; then
  say "СТОП: nginx -t не прошёл. Старый файл возвращён."
  log "откат: nginx -t не прошёл при переходе на $NAME"
  rollback; exit 4
fi
if ! "$NGINX" -s reload >/dev/null 2>&1; then
  say "СТОП: reload не удался. Старый файл возвращён."
  log "откат: reload не удался при переходе на $NAME"
  rollback; exit 4
fi
log "домен: $(name_of "${OLD:-0}") -> $NAME (порт $PORT)"
say "ok: домен переключён на $NAME (порт $PORT)"
exit 0
