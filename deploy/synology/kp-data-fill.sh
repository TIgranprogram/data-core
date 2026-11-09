#!/usr/bin/env bash
# KP-2 (2026-11-09, разрешено пользователем): данные КП на проде — реквизиты и НДС 22 % трёх наших фирм,
# «Приват-деал» только для КП, бланки фирм с зонами текста. Запускает пользователь (запись на прод).
#   bash deploy/synology/kp-data-fill.sh
# ВЫПОЛНЕН 2026-11-09 (7/7). Повтор загрузит бланки ещё раз (дубли) — не запускать без нужды.
# Бланки берутся из папки КП (в репо не лежат: в них подписи и печати).
set -uo pipefail
cd "$(dirname "$0")/../.."
API="bash deploy/synology/api.sh prod"
BL="${KP_BLANKS:-D:/invSportiN/Офис/КП/КП_ООО «ИнжПроектСтрой»_2_06.11.2026/Бланки_для_приложения}"
SIN=6ad52bec863df73f344ea489; SSU=6ad52bed863df73f344ea517; PD=6aeb05349257daffedf6ae2f
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
ok=0; bad=0
step() { local name="$1"; shift; local out; out="$("$@" 2>&1)"; if grep -qE '"statusCode":\s*[45][0-9][0-9]|вход не удался|^curl:' <<<"$out"; then echo "✗ $name: $out" | cut -c1-300; bad=$((bad+1)); else echo "✓ $name"; ok=$((ok+1)); fi; }

printf '{"inn":"2310181417","ogrn":"1152310000040","vatRate":22}' > "$T/sin.json"
printf '{"inn":"2312308098","kpp":"231201001","ogrn":"1222300008358","vatRate":22}' > "$T/ssu.json"
printf '{"inn":"2308065156","kpp":"231101001","vatRate":22}' > "$T/pd.json"
printf '{"offersOnly":true}' > "$T/only.json"

step "СпортИН-ЮГ: ИНН, ОГРН, НДС 22 %"   $API PATCH "/api/organizations/$SIN" "$T/sin.json"
step "СпортСтройЮГ: ИНН, КПП, ОГРН, НДС 22 %" $API PATCH "/api/organizations/$SSU" "$T/ssu.json"
step "Приват-деал: ИНН, КПП, НДС 22 %"   $API PATCH "/api/organizations/$PD" "$T/pd.json"
step "Приват-деал: только для КП"        $API PATCH "/api/offers/companies/$PD" "$T/only.json"

blank() { # $1 файл, $2 название, $3 фирма, $4 верх, $5 низ, $6 стандартные тексты
  [ -f "$BL/$1" ] || { echo "✗ нет файла бланка: $BL/$1"; bad=$((bad+1)); return; }
  cp "$BL/$1" "$T/b.jpg"
  # путь вида C:/… — иначе Git Bash портит «/tmp/…;type=…» для curl из Windows (2026-11-09: curl 26)
  local f="$T/b.jpg"; command -v cygpath >/dev/null && f="$(cygpath -m "$f")"
  # русский текст — из файла (name=<файл): аргументом curl из PowerShell он уходит в cp1251 (2026-11-09: «��»)
  printf '%s' "$2" > "$T/name.txt"; printf '%s' "${6:-}" > "$T/terms.txt"
  local nf="$T/name.txt" tf="$T/terms.txt"; command -v cygpath >/dev/null && { nf="$(cygpath -m "$nf")"; tf="$(cygpath -m "$tf")"; }
  local extra=(); [ -n "${6:-}" ] && extra=(--form "defaultTerms=<$tf")
  step "Бланк: $2" $API POST /api/offers/backgrounds --form "file=@$f;type=image/jpeg" --form "name=<$nf" \
    --form page=1 --form isDefault=true --form "companyId=$3" --form "textTop=$4" --form "textBottom=$5" "${extra[@]}"
}
blank "Бланк_СпортИН-ЮГ.jpg"   "ООО «СпортИН-ЮГ» · бланк КП"   "$SIN" 0.26 0.78 "Аванс 80 %."
blank "Бланк_СпортСтройЮГ.jpg" "ООО «СпортСтройЮГ» · бланк КП" "$SSU" 0.11 0.78
blank "Бланк_Приват-деал.jpg"  "ООО «Приват-деал» · бланк КП"  "$PD"  0.11 0.78

echo "Итого: готово $ok, ошибок $bad"
[ "$bad" -eq 0 ]
