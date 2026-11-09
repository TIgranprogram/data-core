#!/usr/bin/env bash
# C054 B4 (2026-11-09, решения пользователя по аудиту приняты в чате): запись плана воронки паспортов на прод.
#   bash deploy/synology/c054-passport-plan.sh
# Что делает (по docs/crew/C054-passport-funnel/apply-plan.json):
#   1) признаки (traits) у записей справочников паспортов — PATCH /api/dicts/<справочник>/<id>;
#   2) новые записи: способ «Укладывается на основание», материал «Сталь … (лист)», вид «Приствольная решётка» — POST, если записи с таким кодом ещё нет;
#   3) тексты категорий BLG/TRN/WRK/DIO с условиями — PUT /api/passports/texts.
# Запускать ТОЛЬКО после выкладки кода C054 (иначе сервер отклонит новые поля). Выданные паспорта и № 597 не меняются.
# Повтор безопасен: PATCH и PUT ставят те же значения, новые записи не дублируются.
set -uo pipefail
cd "$(dirname "$0")/../.."
API="bash deploy/synology/api.sh prod"
PLAN="docs/crew/C054-passport-funnel/apply-plan.json"
[ -f "$PLAN" ] || { echo "✗ нет файла плана: $PLAN"; exit 2; }
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
ok=0; bad=0; skip=0
step() { local name="$1"; shift; local out; out="$("$@" 2>&1)"; if grep -qE '"statusCode":\s*[45][0-9][0-9]|вход не удался|^curl:' <<<"$out"; then echo "✗ $name: $out" | cut -c1-300; bad=$((bad+1)); else echo "✓ $name"; ok=$((ok+1)); fi; }

# План → строки «вид|метод|путь|файл-тела|подпись|справочник|код» (тела — в отдельных файлах, русский текст не идёт аргументом)
node -e '
const fs = require("fs"), path = require("path");
const [plan, dir] = process.argv.slice(1);
const p = JSON.parse(fs.readFileSync(plan, "utf8"));
let n = 0; const out = [];
const put = (o) => { const f = path.join(dir, `b${++n}.json`); fs.writeFileSync(f, JSON.stringify(o)); return f; };
for (const d of p.dicts || []) out.push(["patch", "PATCH", `/api/dicts/${d.dict}/${d.id}`, put(d.set), `признаки ${d.dict} ${d.code}: ${d.set.traits ?? ""}`, d.dict, d.code].join("|"));
for (const c of p.create || []) out.push(["create", "POST", `/api/dicts/${c.dict}`, put(c.body), `новая запись ${c.dict} ${c.body.code}`, c.dict, c.body.code].join("|"));
for (const t of p.templates || []) out.push(["text", t.method, t.path, put(t.body), `тексты категории ${t.body.category}`, "", ""].join("|"));
fs.writeFileSync(path.join(dir, "steps.txt"), out.join("\n") + "\n");
' "$PLAN" "$T" || { echo "✗ план не прочитан"; exit 2; }

while IFS='|' read -r kind method path body label dict code; do
  [ -n "$kind" ] || continue
  f="$body"; command -v cygpath >/dev/null && f="$(cygpath -m "$f")"
  if [ "$kind" = "create" ]; then
    if $API GET "/api/dicts/$dict?limit=1000" 2>/dev/null | grep -q "\"code\":\"$code\""; then echo "· $label — уже есть"; skip=$((skip+1)); continue; fi
  fi
  step "$label" $API "$method" "$path" "$f"
done < "$T/steps.txt"

echo "Итого: готово $ok, уже было $skip, ошибок $bad"
[ "$bad" -eq 0 ]
