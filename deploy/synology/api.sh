#!/usr/bin/env bash
# Вход агента-доступа в API без показа пароля: сам логинится и делает ОДИН запрос.
#   bash deploy/synology/api.sh <local|prod> <GET|POST|PATCH|DELETE> </путь> [файл-с-телом.json]
# Печатает только ответ API. Пароль берёт из deploy/synology/config.env (ADMIN_PASSWORD) или
# из локального gitignored deploy/synology/access.env (ACCESS_USER, ACCESS_PASSWORD) — если админ сменил пароль.
# Запись на прод (POST/PATCH/DELETE) — только после разрешения пользователя (решает координатор).
set -euo pipefail
cd "$(dirname "$0")"
env_name="${1:?local|prod}"; method="${2:?GET|POST|...}"; path="${3:?/api/...}"; body="${4:-}"
case "$env_name" in
  local) base="http://localhost:3001" ;;
  prod)  base="https://kppdf-crm.ru/db" ;;
  *) echo "первый параметр: local или prod" >&2; exit 2 ;;
esac
get() { [ -f "$2" ] && grep -E "^$1=" "$2" | head -1 | cut -d= -f2- | tr -d '\r"' || true; }
user="$(get ACCESS_USER access.env)"; pass="$(get ACCESS_PASSWORD access.env)"
[ -n "$user" ] || user=admin
[ -n "$pass" ] || pass="$(get ADMIN_PASSWORD config.env)"
[ -n "$pass" ] || { echo "нет пароля: заполните ADMIN_PASSWORD в config.env или access.env" >&2; exit 3; }
# Токен живёт ~15 мин: держим его 10 мин в кэше, чтобы не входить на каждый вызов (вход ограничен 20 в час)
cache="${TMPDIR:-/tmp}/.datacore-token-$env_name"
token=""
if [ -f "$cache" ] && [ -n "$(find "$cache" -mmin -10 2>/dev/null)" ]; then token="$(cat "$cache")"; fi
if [ -z "$token" ]; then
  login="$(curl -sS -X POST "$base/api/auth/login" -H 'Content-Type: application/json' \
    --data-binary @- <<<"$(printf '{"username":"%s","password":"%s"}' "$user" "$pass")")" # тело через stdin — пароль не виден в списке процессов
  token="$(printf '%s' "$login" | sed -n 's/.*"access":"\([^"]*\)".*/\1/p')"
  [ -n "$token" ] || { echo "вход не удался (лимит 20 входов в час или пароль изменён в админке — тогда ACCESS_PASSWORD в access.env)" >&2; exit 4; }
  (umask 077; printf '%s' "$token" > "$cache")
fi
args=(-sS -X "$method" "$base$path" -H "Authorization: Bearer $token")
[ -n "$body" ] && args+=(-H 'Content-Type: application/json' --data @"$body")
curl "${args[@]}"
