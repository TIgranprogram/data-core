#!/usr/bin/env bash
# C054-P (2026-11-10): категории у частей изделия и материалов/покрытий паспорта.
#   bash deploy/synology/c054-parts-coatings.sh          # прод
#   bash deploy/synology/c054-parts-coatings.sh local    # стенд :3001
# Планы: docs/crew/C054-passport-funnel/parts-categories-plan.json
#        docs/crew/C054-passport-funnel/coatings-categories-plan.json
# Только PATCH categories у существующих записей (action=patch|keep с тем же значением).
# 29 новых частей из parts-new-suggest.json НЕ создаём.
# Повтор безопасен: совпадающие categories пропускаются. Выданные паспорта не меняются.
set -uo pipefail
cd "$(dirname "$0")/../.."
TARGET="${1:-prod}"
case "$TARGET" in local|prod) ;; *) echo "цель: local или prod"; exit 2 ;; esac
API="bash deploy/synology/api.sh $TARGET"
# Р1 (C112): запись повторяется при 503 READ_ONLY по retryAfter (до 5 раз); итог повторов — строка «[запись: …]» в ответе
WRITE="node backend/scripts/lib/write-retry.js $TARGET"
PARTS="docs/crew/C054-passport-funnel/parts-categories-plan.json"
COATS="docs/crew/C054-passport-funnel/coatings-categories-plan.json"
[ -f "$PARTS" ] || { echo "✗ нет плана частей: $PARTS"; exit 2; }
[ -f "$COATS" ] || { echo "✗ нет плана покрытий: $COATS"; exit 2; }
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
ok=0; bad=0; skip=0
win() { local f="$1"; command -v cygpath >/dev/null && f="$(cygpath -m "$f")"; echo "$f"; }

# Два плана → строки «dict|id|categories|подпись»
node -e '
const fs = require("fs"), path = require("path");
const [partsF, coatsF, dir] = process.argv.slice(1);
const rows = [];
for (const [file, dict] of [[partsF, "passportParts"], [coatsF, "passportMaterials"]]) {
  const arr = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(arr)) throw new Error("план не массив: " + file);
  for (const x of arr) {
    if (!x.id || x.categories == null || x.categories === "") continue;
    const label = `${dict} ${x.name || x.code || x.id} → ${x.categories}`.replace(/\|/g, "/").slice(0, 100);
    rows.push([dict, x.id, String(x.categories), label].join("|"));
  }
}
fs.writeFileSync(path.join(dir, "steps.txt"), rows.join("\n") + (rows.length ? "\n" : ""));
' "$PARTS" "$COATS" "$T" < /dev/null || { echo "✗ план не прочитан"; exit 2; }

while IFS='|' read -r dict id cats label; do
  [ -n "$dict" ] || continue
  cur="$T/cur-$dict-$id.json"
  if ! $API GET "/api/dicts/$dict/$id" > "$cur" 2>/dev/null; then echo "✗ $label: не прочиталось"; bad=$((bad+1)); continue; fi
  body="$T/body-$dict-$id.json"
  res="$(node -e '
const fs = require("fs");
const [curF, cats, out] = process.argv.slice(1);
const r = JSON.parse(fs.readFileSync(curF, "utf8"));
if (!r || !(r.id || r._id)) { console.log("bad"); process.exit(0); }
const now = String(r.categories || "").replace(/\s+/g, "");
const want = String(cats || "").replace(/\s+/g, "");
if (now === want) { console.log("skip"); process.exit(0); }
fs.writeFileSync(out, JSON.stringify({ categories: cats }));
console.log("patch");
' "$cur" "$cats" "$body" < /dev/null)"
  if [ "$res" = "skip" ]; then echo "· уже так: $label"; skip=$((skip+1)); continue; fi
  if [ "$res" != "patch" ]; then echo "✗ $label: ответ не разобран ($res)"; bad=$((bad+1)); continue; fi
  out="$($WRITE PATCH "/api/dicts/$dict/$id" "$(win "$body")" 2>&1)"
  if grep -qE '"statusCode":\s*[45][0-9][0-9]|вход не удался|^curl:' <<<"$out"; then echo "✗ $label: $out" | cut -c1-300; bad=$((bad+1)); else echo "✓ $label $(grep -o '\[запись: повторено[^]]*\]' <<<"$out")"; ok=$((ok+1)); fi
  sleep 0.15
done < "$T/steps.txt"

echo "Итог ($TARGET): записано $ok, пропущено $skip, ошибок $bad"
[ "$bad" -eq 0 ]
