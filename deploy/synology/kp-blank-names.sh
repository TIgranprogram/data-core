#!/usr/bin/env bash
# KP-2 (2026-11-09): исправить названия трёх бланков КП и стандартный текст СпортИН-ЮГ на проде.
# kp-data-fill.sh передал русский текст аргументом curl — из PowerShell он ушёл в cp1251 и сохранился «��».
# Здесь текст идёт телом JSON из файла (printf — встроенная команда bash, байты UTF-8 не меняются).
#   bash deploy/synology/kp-blank-names.sh
set -uo pipefail
cd "$(dirname "$0")/../.."
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
ok=0; bad=0
fix() { # $1 id бланка, $2 файл тела
  local out; out="$(bash deploy/synology/api.sh prod PATCH "/api/offers/backgrounds/$1" "$2" 2>&1)"
  if grep -q '�' <<<"$out" || grep -qE '"statusCode":\s*[45][0-9][0-9]|^curl:' <<<"$out"; then echo "✗ $1: $out" | cut -c1-300; bad=$((bad+1)); else echo "✓ $(sed -n 's/.*"name":"\([^"]*\)".*/\1/p' <<<"$out")"; ok=$((ok+1)); fi
}
printf '{"name":"ООО «СпортИН-ЮГ» · бланк КП","defaultTerms":"Аванс 80 %%."}' > "$T/sin.json"
printf '{"name":"ООО «СпортСтройЮГ» · бланк КП"}' > "$T/ssu.json"
printf '{"name":"ООО «Приват-деал» · бланк КП"}' > "$T/pd.json"
fix 6af17b4e01efcbdcb464e64e "$T/sin.json"
fix 6af17b4f01efcbdcb464e655 "$T/ssu.json"
fix 6af17b5001efcbdcb464e65c "$T/pd.json"
echo "Итого: готово $ok, ошибок $bad"
[ "$bad" -eq 0 ]
