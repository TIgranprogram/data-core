#!/usr/bin/env bash
# C063 (2026-11-10, пользователь: «Конструкция + материалы»): запись плана на прод.
#   bash deploy/synology/c063-joints-materials.sh
# По docs/crew/C063-joints-materials/plan.json (план — backend/scripts/c063-joints-materials-plan.js):
#   1) конструкция: GET свежих умолчаний паспорта → дописать joints, только если пусто → PUT /api/showcase/<id>/passport-defaults
#      (PUT заменяет умолчания целиком — берём свежие, остальное не трогаем; параллельно пишет C062);
#   2) материалы: PATCH /api/showcase/<id> {materialsSpec}, только если таблица всё ещё пустая.
# «Вручную» (jointsManual, specManual) не пишется. Повтор безопасен: заполненное пропускается. Выданные паспорта не меняются.
set -uo pipefail
cd "$(dirname "$0")/../.."
API="bash deploy/synology/api.sh prod"
# Р1 (C112): запись повторяется при 503 READ_ONLY по retryAfter (до 5 раз); итог повторов — строка «[запись: …]» в ответе
WRITE="node backend/scripts/lib/write-retry.js prod"
PLAN="docs/crew/C063-joints-materials/plan.json"
[ -f "$PLAN" ] || { echo "✗ нет файла плана: $PLAN"; exit 2; }
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
ok=0; bad=0; gone=0; skip=0
win() { local f="$1"; command -v cygpath >/dev/null && f="$(cygpath -m "$f")"; echo "$f"; }

node -e '
const fs = require("fs"), path = require("path");
const [plan, dir] = process.argv.slice(1);
const p = JSON.parse(fs.readFileSync(plan, "utf8"));
const out = [];
for (const x of p.joints || []) out.push(["joints", x.id, JSON.stringify(x.joints), `${x.sku} ${x.name}`].join("|"));
for (const x of p.spec || []) { const f = path.join(dir, `s-${x.id}.json`); fs.writeFileSync(f, JSON.stringify({ materialsSpec: x.materialsSpec })); out.push(["spec", x.id, f, `${x.sku} ${x.name}`].join("|")); }
fs.writeFileSync(path.join(dir, "steps.txt"), out.join("\n") + "\n");
' "$PLAN" "$T" < /dev/null || { echo "✗ план не прочитан"; exit 2; }

while IFS='|' read -r kind id arg label; do
  [ -n "$kind" ] || continue
  cur="$T/cur-$id.json"
  got=0; for try in 1 2 3 4; do sleep 0.3; if $API GET "/api/showcase/$id" > "$cur" 2>/dev/null && grep -q "\"id\"" "$cur"; then got=1; break; fi; sleep $((try*2)); done  # частые GET сервер отклоняет — пауза и повтор
  if [ "$got" != 1 ] && grep -q 'Изделие не найдено' "$cur" 2>/dev/null; then echo "· $label: изделие удалено с сайта — пропуск"; gone=$((gone+1)); continue; fi
  if [ "$got" != 1 ]; then echo "✗ $label: не прочиталось: $(head -c 150 "$cur")"; bad=$((bad+1)); continue; fi
  if [ "$kind" = "joints" ]; then
    body="$T/pd-$id.json"
    res="$(node -e '
const fs = require("fs"); const [curF, joints, out] = process.argv.slice(1);
const r = JSON.parse(fs.readFileSync(curF, "utf8")); const pd = { ...(r.passportDefaults || {}) };
if ((pd.joints || []).length) { console.log("skip"); process.exit(0); }
pd.joints = JSON.parse(joints);
const body = Object.fromEntries(Object.entries(pd).filter(([, v]) => v !== undefined && v !== null && v !== ""));
body.textChoices = pd.textChoices || {};
fs.writeFileSync(out, JSON.stringify(body)); console.log("put");
' "$cur" "$arg" "$body" < /dev/null)"
    if [ "$res" = "skip" ]; then echo "· конструкция уже есть: $label"; skip=$((skip+1)); continue; fi
    out="$($WRITE PUT "/api/showcase/$id/passport-defaults" "$(win "$body")" 2>&1)"
  else
    if node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); process.exit((r.materialsSpec?.rows||[]).length ? 0 : 1)' "$cur" < /dev/null; then echo "· материалы уже есть: $label"; skip=$((skip+1)); continue; fi
    out="$($WRITE PATCH "/api/showcase/$id" "$(win "$arg")" 2>&1)"
  fi
  if grep -q 'Изделие не найдено' <<<"$out"; then echo "· изделие удалено с сайта — пропуск"; gone=$((gone+1)); elif grep -qE '"statusCode":\s*[45][0-9][0-9]|вход не удался|^curl:' <<<"$out"; then echo "✗ $kind $label: $out" | cut -c1-300; bad=$((bad+1)); else echo "✓ $kind $label $(grep -o '\[запись: повторено[^]]*\]' <<<"$out")"; ok=$((ok+1)); fi
  sleep 0.3
done < "$T/steps.txt"

echo "Итог: записано $ok, пропущено (уже заполнено) $skip, удалено с сайта $gone, ошибок $bad"
[ "$bad" -eq 0 ]
