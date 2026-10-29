#!/usr/bin/env bash
# Проверка после выкладки (RELEASE-GATE RG-9): ошибки с сайта (clienterrors) с момента выкладки — только чтение.
#   bash deploy/synology/post-check.sh [часы]
# Часы по умолчанию — с последнего тега release-* (если тегов нет — 2 ч). Запускает агент datacore-access через 1–2 ч после release.sh.
# Последняя строка: «ПОСЛЕ ВЫКЛАДКИ: чисто» или «ПОСЛЕ ВЫКЛАДКИ: N новых групп ошибок — в очередь первыми».
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
HOURS="${1:-}"
if [[ -z "$HOURS" ]]; then
  T="$(git for-each-ref --sort=-creatordate --count=1 --format='%(creatordate:unix)' 'refs/tags/release-*')"
  [[ -n "$T" ]] && HOURS=$(( ( $(date +%s) - T ) / 3600 + 1 )) || HOURS=2
fi
# версия — та, что реально на проде (version.json кладёт release.sh), а не локальный HEAD
VER="$(curl -s https://kppdf-crm.ru/db/app/version.json | sed -n 's/.*"v":"\([^"]*\)".*/\1/p')"
[[ -n "$VER" ]] || VER="$(git log -1 --format=%h -- backend/pwa)"
bash deploy/synology/api.sh prod GET "/api/client-errors/top?hours=$HOURS" | VER="$VER" HOURS="$HOURS" node -e '
  let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
    let items; try { items = JSON.parse(s).items || []; } catch { console.log("ПОСЛЕ ВЫКЛАДКИ: ответ API не разобран — " + s.slice(0, 120)); process.exit(1); }
    const ver = process.env.VER, mine = items.filter((e) => (e.version || "").startsWith(ver));
    console.log(`за ${process.env.HOURS} ч: групп ${items.length}, из них в версии ${ver}: ${mine.length}`);
    for (const e of items.slice(0, 5)) console.log(`  ${e.count}× ${e.users} чел · ${e.section || "-"} · ${String(e.message).slice(0, 90)}${(e.version || "").startsWith(ver) ? " · НОВАЯ ВЕРСИЯ" : ""}`);
    console.log(mine.length ? `ПОСЛЕ ВЫКЛАДКИ: ${mine.length} групп ошибок в новой версии — в очередь первыми` : "ПОСЛЕ ВЫКЛАДКИ: чисто");
  });'
