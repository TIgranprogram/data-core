#!/usr/bin/env bash
# C061 (2026-11-10): 8 изделий — не тренажёры, но у них своя категория паспорта «Уличный тренажёр» (TRN).
#   bash deploy/synology/c061-wrong-category.sh
# Список — docs/crew/C061-trainers-load/wrong-category.json (воркаут, ограждение, помост, стойки, павильон).
# Своя категория снимается → действует категория группы (Воркаут / Благоустройство).
# Снимается ТОЛЬКО если своя сейчас TRN. Остальные умолчания паспорта остаются. Выданные паспорта не меняются.
# Повтор безопасен.
set -uo pipefail
cd "$(dirname "$0")/../.."
API="bash deploy/synology/api.sh prod"
LIST="docs/crew/C061-trainers-load/wrong-category.json"
[ -f "$LIST" ] || { echo "✗ нет файла: $LIST"; exit 2; }
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
ok=0; bad=0; skip=0
win() { local f="$1"; command -v cygpath >/dev/null && f="$(cygpath -m "$f")"; echo "$f"; }

node -e 'const l=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));for(const x of l)console.log([x.id,`${x.sku} ${x.name}`.replace(/\|/g,"/").slice(0,80)].join("|"))' "$LIST" > "$T/steps.txt" < /dev/null || { echo "✗ список не прочитан"; exit 2; }

while IFS='|' read -r id label; do
  [ -n "$id" ] || continue
  cur="$T/cur-$id.json"
  got=0; for try in 1 2 3 4; do sleep 0.3; if $API GET "/api/showcase/$id" > "$cur" 2>/dev/null && grep -q "\"id\"" "$cur"; then got=1; break; fi; sleep $((try*2)); done
  if [ "$got" != 1 ]; then echo "✗ $label: не прочиталось"; bad=$((bad+1)); continue; fi
  body="$T/pd-$id.json"
  res="$(node -e '
const fs = require("fs"); const [curF, out] = process.argv.slice(1);
const r = JSON.parse(fs.readFileSync(curF, "utf8"));
const pd = { ...(r.passportDefaults || {}) };
const own = pd.passportCategory; const code = own && (own.code || own);
if (code !== "TRN") { console.log("skip"); process.exit(0); }
delete pd.passportCategory;
const body = Object.fromEntries(Object.entries(pd).filter(([, v]) => v !== undefined && v !== null && v !== ""));
if (!body.textChoices) body.textChoices = {};
fs.writeFileSync(out, JSON.stringify(body)); console.log("put");
' "$cur" "$body" < /dev/null)"
  if [ "$res" = "skip" ]; then echo "· уже без TRN: $label"; skip=$((skip+1)); continue; fi
  if [ "$res" != "put" ]; then echo "✗ $label: ответ не разобран"; bad=$((bad+1)); continue; fi
  out="$($API PUT "/api/showcase/$id/passport-defaults" "$(win "$body")" 2>&1)"
  if grep -qE '"statusCode":\s*[45][0-9][0-9]|вход не удался|^curl:' <<<"$out"; then echo "✗ $label: $out" | cut -c1-300; bad=$((bad+1)); else echo "✓ $label"; ok=$((ok+1)); fi
done < "$T/steps.txt"

echo "Итог: исправлено $ok, пропущено $skip, ошибок $bad"
[ "$bad" -eq 0 ]
