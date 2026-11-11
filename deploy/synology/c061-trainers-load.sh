#!/usr/bin/env bash
# C061 (2026-11-10, решение пользователя: тренажёры — «Грузоблочные» и «Суставные» = все без грузов): запись плана на прод.
#   bash deploy/synology/c061-trainers-load.sh
# Что делает (по docs/crew/C061-trainers-load/plan.json, план собирает backend/scripts/c061-trainers-load-plan.js):
#   1) признак «Нагрузка»: weights → «Изменяемая (грузы)», body → «Собственный вес» — PATCH /api/showcase/<id> {facetValueIds};
#      прежние значения признаков изделия сохраняются (в плане — весь новый список);
#   2) moveGroup — тренажёры из чужой группы → «Спортивное оборудование › Тренажеры» — PATCH {type, group}. Артикулы не меняются.
# «Спорные» (ask) и «не тренажёр с категорией ТРН» (wrongCategory) — НЕ пишутся, только в отчёте плана.
# Повтор безопасен: PATCH ставит те же значения. Выданные паспорта не меняются.
set -uo pipefail
cd "$(dirname "$0")/../.."
API="bash deploy/synology/api.sh prod"
PLAN="docs/crew/C061-trainers-load/plan.json"
[ -f "$PLAN" ] || { echo "✗ нет файла плана: $PLAN"; exit 2; }
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
ok=0; bad=0; gone=0
step() { local name="$1"; shift; local out; out="$("$@" 2>&1)"; if grep -q 'Изделие не найдено' <<<"$out"; then echo "· изделие удалено с сайта — пропуск"; gone=$((gone+1)); elif grep -qE '"statusCode":\s*[45][0-9][0-9]|вход не удался|^curl:' <<<"$out"; then echo "✗ $name: $out" | cut -c1-300; bad=$((bad+1)); else echo "✓ $name"; ok=$((ok+1)); fi; }

# План → строки «путь|файл-тела|подпись» (тела — в файлах: русский текст не идёт аргументом)
node -e '
const fs = require("fs"), path = require("path");
const [plan, dir] = process.argv.slice(1);
const p = JSON.parse(fs.readFileSync(plan, "utf8"));
let n = 0; const out = [];
const put = (o) => { const f = path.join(dir, `b${++n}.json`); fs.writeFileSync(f, JSON.stringify(o)); return f; };
for (const x of p.weights || []) out.push([`/api/showcase/${x.id}`, put({ facetValueIds: x.facetValueIds }), `грузы: ${x.sku} ${x.name}`].join("|"));
for (const x of p.body || []) out.push([`/api/showcase/${x.id}`, put({ facetValueIds: x.facetValueIds }), `собственный вес: ${x.sku} ${x.name}`].join("|"));
for (const x of p.moveGroup || []) out.push([`/api/showcase/${x.id}`, put({ type: x.type, group: x.to }), `в группу «${x.to}»: ${x.sku} ${x.name}`].join("|"));
fs.writeFileSync(path.join(dir, "steps.txt"), out.join("\n") + "\n");
' "$PLAN" "$T" < /dev/null || { echo "✗ план не прочитан"; exit 2; }

while IFS='|' read -r path body label; do
  [ -n "$path" ] || continue
  f="$body"; command -v cygpath >/dev/null && f="$(cygpath -m "$f")"
  step "$label" $API PATCH "$path" "$f"
done < "$T/steps.txt"

echo "Итог: записано $ok, удалено с сайта $gone, ошибок $bad"
[ "$bad" -eq 0 ]
