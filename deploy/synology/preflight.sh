#!/usr/bin/env bash
# Ворота перед выкладкой (RELEASE-GATE, этап 1). Запускает release.sh первым шагом; можно и отдельно:
#   bash deploy/synology/preflight.sh [--force-urgent]
# Код 0 — можно выкладывать; 1 — нельзя. Последняя строка: «ВОРОТА: ОК» или «ВОРОТА: СТОП — причина».
# Что проверяется — только то, что менялось с последней выкладки (тег release-*):
#   1 нет незакоммиченного · 2 HEAD запушен в origin · 4 backend/src → tsc + весь юнит
#   5 pwa/admin → импорты и синтаксис, node --test, pwa-guards · 6 pwa/admin → в коммитах «Дизайнер: принято|не нужно»
#   7 коммит «Класс: L|XL» с backend/src → свежая строка TEST-LOG с e2e ✅
# --force-urgent (сайт уже сломан, чиним срочно) пропускает только 6–7; 1–5 не пропускаются никогда.
set -uo pipefail
URGENT=0; for a in "$@"; do [[ "$a" == "--force-urgent" ]] && URGENT=1; done
cd "$(git rev-parse --show-toplevel)"
LOG="$(mktemp)"
stop() { echo "ВОРОТА: СТОП — $1"; rm -f "$LOG"; exit 1; }
ok() { echo "  ✓ $1"; }

# 1. всё закоммичено
[[ -z "$(git status --porcelain -- backend deploy docker-compose.prod.yml)" ]] || stop "есть незакоммиченные изменения в backend/deploy — сначала коммит"
ok "незакоммиченного нет"

# 2. HEAD есть в origin (дом ↔ работа: на прод не уходит то, чего нет в репо)
BR="$(git rev-parse --abbrev-ref HEAD)"
git fetch -q origin "$BR" 2>/dev/null || echo "  ! git fetch не прошёл — сверяю с последним известным origin/$BR"
git merge-base --is-ancestor HEAD "origin/$BR" 2>/dev/null || stop "коммит $(git rev-parse --short HEAD) не запушен в origin/$BR — сначала git push"
ok "HEAD $(git rev-parse --short HEAD) есть в origin/$BR"

# 3. что менялось с прошлой выкладки
BASE="$(git describe --tags --abbrev=0 --match 'release-*' 2>/dev/null)"
FIRST=0; [[ -z "$BASE" ]] && { BASE="$(git rev-parse HEAD~20)"; FIRST=1; }
CHANGED="$(git diff --name-only "$BASE" HEAD)"
SRC=0; UI=0
grep -qE '^backend/(src|test)/|^backend/package\.json$' <<<"$CHANGED" && SRC=1
grep -qE '^backend/(pwa|admin)/' <<<"$CHANGED" && UI=1
ok "с $( [[ $FIRST == 1 ]] && echo "HEAD~20 (тега выкладки ещё нет)" || echo "$BASE"): сервер $([[ $SRC == 1 ]] && echo менялся || echo нет), экран $([[ $UI == 1 ]] && echo менялся || echo нет)"

# 4. сервер: типы и весь юнит
if [[ $SRC == 1 ]]; then
  (cd backend && npx tsc --noEmit) >"$LOG" 2>&1 || { tail -8 "$LOG"; stop "tsc: ошибки типов"; }
  (cd backend && npx jest --silent) >"$LOG" 2>&1 || { grep -E '●|FAIL|Tests:' "$LOG" | head -8; stop "юнит-тесты упали"; }
  ok "tsc 0; юнит: $(grep -E '^Tests:' "$LOG" | tail -1 | sed 's/^Tests: *//')"
fi

# 5. экран: синтаксис и импорты всех .js, тесты логики приложения, pwa-guards
if [[ $UI == 1 ]]; then
  node backend/scripts/pwa-import-check.mjs >"$LOG" 2>&1 || { head -8 "$LOG"; stop "приложение/админка: сломан синтаксис или импорт"; }
  ok "$(tail -1 "$LOG")"
  node --test "backend/pwa/**/*.test.mjs" >"$LOG" 2>&1 || { grep -E 'not ok|fail' "$LOG" | head -6; stop "node --test приложения упал"; }
  (cd backend && npx jest src/pwa-guards --silent) >"$LOG" 2>&1 || { grep -E '●|Tests:' "$LOG" | head -6; stop "pwa-guards упал"; }
  ok "node --test и pwa-guards зелёные"
fi

# 6–7. след процесса в коммитах (трейлеры CLAUDE.md «Правила работы»)
if [[ $URGENT == 1 ]]; then
  echo "  ! --force-urgent: приёмка дизайнера и full не проверялись — после выкладки догнать"
elif [[ $FIRST == 1 ]]; then
  echo "  ! первая выкладка с воротами: метки «Дизайнер:» и «Класс:» не проверялись (тега release-* ещё нет)"
else
  if [[ $UI == 1 ]]; then
    MISS=""
    for h in $(git rev-list "$BASE..HEAD" -- backend/pwa backend/admin); do
      git log -1 --format=%B "$h" | grep -qE '^Дизайнер: (принято|не нужно)' || MISS+=" $(git rev-parse --short "$h")"
    done
    [[ -z "$MISS" ]] || stop "коммиты вида без «Дизайнер: принято|не нужно»:$MISS — нужен просмотр datacore-designer"
    ok "приёмка дизайнера отмечена"
  fi
  BIG=""
  for h in $(git rev-list "$BASE..HEAD" -- backend/src); do
    git log -1 --format=%B "$h" | grep -qE '^Класс: (L|XL)' && { BIG="$h"; break; }
  done
  if [[ -n "$BIG" ]]; then
    T_LOG="$(git log -1 --format=%ct -- docs/TEST-LOG.md)"; T_BIG="$(git log -1 --format=%ct "$BIG")"
    LAST="$(grep -E '^\|' docs/TEST-LOG.md | tail -1)"
    [[ "${T_LOG:-0}" -ge "$T_BIG" ]] && grep -q 'e2e' <<<"$LAST" && grep -q '✅' <<<"$LAST" && ! grep -qE 'не гонял|нет Docker' <<<"$LAST" \
      || stop "в выкладке есть L/XL ($(git rev-parse --short "$BIG")), а свежей строки TEST-LOG с e2e ✅ нет — нужен full (Docker)"
    ok "full для L/XL есть в TEST-LOG"
  fi
fi

rm -f "$LOG"
echo "ВОРОТА: ОК"
