#!/usr/bin/env bash
# Вход агента-доступа в API без показа пароля: сам логинится и делает ОДИН запрос.
#   bash deploy/synology/api.sh <local|prod|stand> <GET|POST|PATCH|DELETE> </путь> [файл-с-телом.json]
#   загрузка файла (multipart): ... </путь> --form 'file=@путь' --form 'name=…' [--form …]
#   изолированный браузер: ... stand BROWSER tools/logs/проверенный-сценарий.mjs
#   BROWSER передаёт {access,refresh,user} только в stdin node, без файла сессии и кэша токена.
# Печатает только ответ API. Пароль берёт из deploy/synology/config.env (ADMIN_PASSWORD) или
# из локального gitignored deploy/synology/access.env (ACCESS_USER, ACCESS_PASSWORD) — если админ сменил пароль.
# Запись на прод (POST/PATCH/DELETE) — только после разрешения пользователя (решает координатор).
set -euo pipefail
caller_dir="$PWD"
cd "$(dirname "$0")"
env_name="${1:?local|prod|stand}"; method="${2:?GET|POST|...}"; path="${3:?/api/...}"; body="${4:-}"
case "$env_name" in
  local) base="http://localhost:3001" ;;
  prod)  base="https://kppdf-crm.ru/db" ;;
  stand) base="http://localhost:3102" ;;
  *) echo "первый параметр: local, prod или stand" >&2; exit 2 ;;
esac
# Изолированный браузер: секреты идут только в stdin проверенного сценария.
browser_script=""
if [ "$method" = "BROWSER" ]; then
  [ "$env_name" = "stand" ] || { echo "BROWSER разрешён только для stand" >&2; exit 2; }
  browser_script="$(node -e '
    const fs=require("node:fs"), p=require("node:path");
    try {
      const root=fs.realpathSync(p.resolve("../../tools/logs"));
      const script=fs.realpathSync(p.resolve(process.argv[1],process.argv[2]));
      const rel=p.relative(root,script);
      if (!rel || rel.startsWith(".."+p.sep) || rel===".." || p.isAbsolute(rel) || !script.endsWith(".mjs") || !fs.statSync(script).isFile()) throw Error();
      process.stdout.write(script);
    } catch { console.error("BROWSER: нужен существующий .mjs внутри tools/logs"); process.exit(2); }
  ' "$caller_dir" "$path")" || exit 2
fi
get() { [ -f "$2" ] && grep -E "^$1=" "$2" | head -1 | cut -d= -f2- | tr -d '\r"' || true; }
if [ "$env_name" = "stand" ]; then
  user="$(get STAND_LOGIN ../../tools/logs/stand-login.local.env)"
  pass="$(get STAND_PASSWORD ../../tools/logs/stand-login.local.env)"
  [ -n "$user" ] && [ -n "$pass" ] || { echo "нет учётной записи изолированного стенда" >&2; exit 3; }
else
user="$(get ACCESS_USER access.env)"; pass="$(get ACCESS_PASSWORD access.env)"
[ -n "$user" ] || user=admin
[ -n "$pass" ] || pass="$(get ADMIN_PASSWORD config.env)"
fi
[ -n "$pass" ] || { echo "нет пароля: заполните ADMIN_PASSWORD в config.env или access.env" >&2; exit 3; }
# Токен живёт ~15 мин: держим его 10 мин в кэше, чтобы не входить на каждый вызов (вход ограничен 20 в час)
cache="${TMPDIR:-/tmp}/.datacore-token-$env_name"
token=""
if [ "$method" != "BROWSER" ] && [ -f "$cache" ] && [ -n "$(find "$cache" -mmin -10 2>/dev/null)" ]; then token="$(cat "$cache")"; fi
if [ -z "$token" ]; then
  login="$(curl -sS -X POST "$base/api/auth/login" -H 'Content-Type: application/json' \
    --data-binary @- <<<"$(printf '{"username":"%s","password":"%s"}' "$user" "$pass")")" # тело через stdin — пароль не виден в списке процессов
  token="$(printf '%s' "$login" | sed -n 's/.*"access":"\([^"]*\)".*/\1/p')"
  [ -n "$token" ] || { echo "вход не удался (лимит 20 входов в час или пароль изменён в админке — тогда ACCESS_PASSWORD в access.env)" >&2; exit 4; }
  if [ "$method" != "BROWSER" ]; then (umask 077; printf '%s' "$token" > "$cache"); fi
fi
if [ "$method" = "BROWSER" ]; then
  refresh="$(printf '%s' "$login" | sed -n 's/.*"refresh":"\([^"]*\)".*/\1/p')"
  [ -n "$refresh" ] || { echo "BROWSER: refresh не получен" >&2; exit 4; }
  me="$(curl -fsS "$base/api/auth/me" -H "Authorization: Bearer $token")" || { echo "BROWSER: auth/me не получен" >&2; exit 4; }
  printf '{"access":"%s","refresh":"%s","user":%s}' "$token" "$refresh" "$me" | node "$browser_script"
  exit "$?"
fi
args=(-sS -X "$method" "$base$path" -H "Authorization: Bearer $token")
if [ "$body" = "--form" ]; then
  shift 3; while [ "$#" -ge 2 ] && [ "$1" = "--form" ]; do args+=(-F "$2"); shift 2; done
elif [ -n "$body" ]; then args+=(-H 'Content-Type: application/json' --data @"$body"); fi
curl "${args[@]}"
