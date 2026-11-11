#!/usr/bin/env bash
# C062 (2026-11-10): «Назначение», «Элементы», «Способ установки» в умолчаниях паспорта изделий. Запись плана на прод.
#   bash deploy/synology/c062-passport-purpose.sh
# По docs/crew/C062-passport-purpose/plan.json (план — backend/scripts/c062-passport-purpose-plan.js, список — REVIEW.md):
#   для каждого изделия GET свежих умолчаний → дописать ТОЛЬКО пустое (elements, installationTypeId, выбор в разделе «Назначение»)
#   → PUT /api/showcase/<id>/passport-defaults (PUT заменяет умолчания целиком — поэтому берём свежие; joints, textOverrides,
#   числа и всё остальное остаются как есть; параллельно пишет C063).
# «Вручную» (manual) не пишется. Повтор безопасен: заполненное пропускается. Выданные паспорта не меняются.
set -uo pipefail
cd "$(dirname "$0")/../.."
API="bash deploy/synology/api.sh prod"
PLAN="docs/crew/C062-passport-purpose/plan.json"
[ -f "$PLAN" ] || { echo "✗ нет файла плана: $PLAN"; exit 2; }
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
ok=0; bad=0; gone=0; skip=0
win() { local f="$1"; command -v cygpath >/dev/null && f="$(cygpath -m "$f")"; echo "$f"; }

# План → строки «id|файл-с-дополнением|подпись» (русский текст не идёт аргументом)
node -e '
const fs = require("fs"), path = require("path");
const [plan, dir] = process.argv.slice(1);
const p = JSON.parse(fs.readFileSync(plan, "utf8"));
const out = [];
for (const x of p.set || []) { const f = path.join(dir, `a-${x.id}.json`); fs.writeFileSync(f, JSON.stringify(x.set)); out.push([x.id, f, `${x.sku} ${x.name}`.replace(/\|/g, "/").slice(0, 80)].join("|")); }
fs.writeFileSync(path.join(dir, "steps.txt"), out.join("\n") + "\n");
' "$PLAN" "$T" < /dev/null || { echo "✗ план не прочитан"; exit 2; }

while IFS='|' read -r id add label; do
  [ -n "$id" ] || continue
  cur="$T/cur-$id.json"
  got=0; for try in 1 2 3 4; do sleep 0.3; if $API GET "/api/showcase/$id" > "$cur" 2>/dev/null && grep -q "\"id\"" "$cur"; then got=1; break; fi; sleep $((try*2)); done  # частые GET сервер отклоняет — пауза и повтор
  if [ "$got" != 1 ] && grep -q 'Изделие не найдено' "$cur" 2>/dev/null; then echo "· $label: изделие удалено с сайта — пропуск"; gone=$((gone+1)); continue; fi
  if [ "$got" != 1 ]; then echo "✗ $label: не прочиталось: $(head -c 150 "$cur")"; bad=$((bad+1)); continue; fi
  body="$T/pd-$id.json"
  res="$(node -e '
const fs = require("fs"); const [curF, addF, out] = process.argv.slice(1);
const r = JSON.parse(fs.readFileSync(curF, "utf8")); if (!r || !r.id) { console.log("bad"); process.exit(0); }
const add = JSON.parse(fs.readFileSync(addF, "utf8"));
const pd = { ...(r.passportDefaults || {}) }; let changed = false;
if (add.elements && !(pd.elements || []).length) { pd.elements = add.elements; changed = true; }
if (add.installationTypeId && !pd.installationTypeId) { pd.installationTypeId = add.installationTypeId; changed = true; }
if (add.textChoices) { const tc = { ...(pd.textChoices || {}) }; for (const [k, v] of Object.entries(add.textChoices)) if (!tc[k]) { tc[k] = v; changed = true; } pd.textChoices = tc; }
if (!changed) { console.log("skip"); process.exit(0); }
const body = Object.fromEntries(Object.entries(pd).filter(([, v]) => v !== undefined && v !== null && v !== ""));
if (!body.textChoices) body.textChoices = {};
fs.writeFileSync(out, JSON.stringify(body)); console.log("put");
' "$cur" "$add" "$body" < /dev/null)"
  if [ "$res" = "skip" ]; then echo "· уже заполнено: $label"; skip=$((skip+1)); continue; fi
  if [ "$res" != "put" ]; then echo "✗ $label: ответ не разобран"; bad=$((bad+1)); continue; fi
  out="$($API PUT "/api/showcase/$id/passport-defaults" "$(win "$body")" 2>&1)"
  if grep -q 'Изделие не найдено' <<<"$out"; then echo "· изделие удалено с сайта — пропуск"; gone=$((gone+1)); elif grep -qE '"statusCode":\s*[45][0-9][0-9]|вход не удался|^curl:' <<<"$out"; then echo "✗ $label: $out" | cut -c1-300; bad=$((bad+1)); else echo "✓ $label"; ok=$((ok+1)); fi
  sleep 0.3
done < "$T/steps.txt"

echo "Итог: записано $ok, пропущено (уже заполнено) $skip, удалено с сайта $gone, ошибок $bad"
[ "$bad" -eq 0 ]
