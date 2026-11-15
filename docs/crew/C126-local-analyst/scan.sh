#!/usr/bin/env bash
# C126: готовые команды для локального аналитика — ТОЛЬКО ЧТЕНИЕ. Запуск из ~/data-core:
#   bash docs/crew/C126-local-analyst/scan.sh <1-5> [файл]
#   без файла — список «что проверить»; с файлом — подробности по нему.
cd "$(dirname "$0")/../../.." || exit 2
N="${1:-}"; F="${2:-}"
case "$N" in
  status) grep -n '^## Задача' docs/crew/C126-local-analyst/REPORT.md 2>/dev/null || echo "Отчёта ещё нет — ни одна задача не сделана." ;;
  1) # метод контроллера: блок декораторов до сигнатуры без @Roles/@Public/@Permissions и класс без них
     for f in $(grep -rl "@Controller" backend/src --include=*.controller.ts); do
       awk -v F="$f" '
         /^@(Roles|Public|Permissions)\(/ { cls=1 }
         /^  @/ { if (!inblk) { inblk=1; blk=""; ln=NR } blk=blk $0 "\n"; next }
         inblk && /^  [a-zA-Z]/ {
           if (blk ~ /@(Get|Post|Put|Patch|Delete)\(/ && blk !~ /@(Roles|Public|Permissions)\(/ && !cls) {
             match(blk, /@(Get|Post|Put|Patch|Delete)\([^)]*\)/); print F ":" ln " " substr(blk, RSTART, RLENGTH) }
           inblk=0 }
       ' "$f"
     done ;;
  2) for m in $(grep -oE "\b[A-Z][A-Za-z]+Module\b" backend/src/app.module.ts | sort -u | grep -vE "^(Mongoose|Config|Schedule|Throttler|EventEmitter|ServeStatic|Terminus|Http|Cache)Module$"); do
       b=${m%Module}; grep -qi "$b" docs/MAP.md && continue
       d=$(ls backend/src/modules | grep -i -m1 "$(echo "$b" | sed 's/\([a-z]\)\([A-Z]\)/\1-\2/g' | tr 'A-Z' 'a-z')" || true)
       c=$( [ -n "$d" ] && grep -rhoE "@Controller\('[^']*'\)" "backend/src/modules/$d" | head -2 | tr '\n' ' ')
       echo "$m — папка: ${d:-?} — маршрут: ${c:-нет}"
     done ;;
  3) grep -rhoIE "process\.env\.[A-Z_]+" backend/src --include=*.ts | sort -u | sed 's/process.env.//' | while read -r v; do
       grep -q "^#\? *$v=" .env.example && continue
       echo "$v — $(grep -rlnI "process.env.$v" backend/src --include=*.ts | head -2 | tr '\n' ' ')"
     done ;;
  4) if [ -z "$F" ]; then
       grep -rcE "\.catch\(\(\) *=> *(\{ *\}|null|undefined|\[\])\)" backend/pwa --include=*.js | grep -v test | grep -v ":0$" | sort -t: -k2 -rn | head -10
     else grep -nE -B2 -A1 "\.catch\(\(\) *=> *(\{ *\}|null|undefined|\[\])\)" "$F" | cut -c1-200 | head -80; fi ;;
  5) if [ -z "$F" ]; then
       find backend/src backend/pwa \( -name "*.ts" -o -name "*.js" \) | grep -vE "spec|test|node_modules" | xargs wc -l | sort -rn | awk '$1>800 && $2!="итого" && $2!="total"' | head -6
     else grep -nE "^export (async )?function|^(export )?class |^  (async )?[a-zA-Z]+\(.*\) \{" "$F" | cut -c1-140 | head -40; fi ;;
  *) echo "Использование: scan.sh status | 1..5 [файл]"; exit 2 ;;
esac
