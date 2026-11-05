# ORDER-W0-B — отчёт frontend (волна 0, часть B)
Статус: готово, не закоммичено. Проверки зелёные: `--check` всех kit/*.js, pwa-import-check (215 файлов, 0 ошибок), pwa-preload (77), jest pwa-guards 213/213, design-lint «новых 0», unit-тесты pwa (node --experimental-vm-modules --test) 93/93, site-audit.test 8/8.

## Что сделано
1. Kit честный ✅. 15 модулей (`git mv`) `ui/{dialog,toast,busy,errors,list,card,badges,pop-menu,drag,gallery,photos,side-form,crumbs,form,empty}.js` → `ui/kit/`; тесты drag/errors — туда же. Импорты переписаны скриптом (sections/*, ui/*, core/*, main.js, тесты); в sections меняли ТОЛЬКО пути. Все `ui/kit/*.js` ≤ 400 (list.js 652 → 399: вынесено в list-tiles/chips/periods/rows/view.js, поведение то же; card.js 368).
2. `data-k` ✅: `kit/mark.js` (`mark`, `markEl`); помечены button, badge, card, actions, row, tabs, iconButton, segmented, link, sku, section, stat(s), toolbar, board/boardStatic, layout.split, table, panel, modal, toast, busyBlock/failBlock, form, drawer (openCard), list, menu (pop-menu), gallery, photoField/photoDrop, readonlyGroup, similarBox, filter(chips/facet/inline/funnel), pick (select/combo/tags/suggest), empty, mobile.* (`mobile.<имя>`).
3. `tools/site-audit.mjs` ✅: правило `s` (A1, счётчик «не из kit: N» по main/.drawer/.modal-back, топ-4 селектора), `q` (карточка article/.tcard/.tile/.db-order без data-k), `r` (кликабельная карточка без k-hover). Запуск на стенде НЕ делал (нужен стенд) — синтаксис сканера проверен, тесты зелёные.
4. `empty()` ✅ (по уточнению — только фабрика + витрина): `kit/empty.js`, `empty({title,hint,action,kind:'empty'|'notFound'|'noData',query,onReset})`; `emptyState` — алиас. Замену самодельных пустых состояний в sections НЕ делал (волны 1+).
5. Витрина `#kit` ✅: блоки «Отметка происхождения (data-k)» и «Пусто и ошибка (empty)» (3 вида). DESIGN §4: строки data-k, Пусто, пути ui/kit/*.

## Файлы — две группы для коммитов
**Коммит 1 — kit (+ аудит, доки):** `backend/pwa/ui/kit/**` (mark.js, empty.js, list-{tiles,chips,periods,rows,view}.js новые; правки data-k в index/table/panel/dialog/toast/busy/form/card/board/filter/pick/pop-menu/gallery/photos/readonly/similar/mobile/list; переименования 15 модулей), `backend/pwa/sections/kit.js`, `backend/pwa/sections/invoice-workspace.test.mjs` (пути + заглушки mark/markEl), `tools/site-audit.mjs`, `docs/DESIGN.md`, `docs/crew/ORDER-W0-B-report.md`, `docs/roles/maps/frontend.md`.
**Коммит 2 — только пути импортов:** остальное в `backend/pwa/sections/**`, `backend/pwa/ui/*.js`, `backend/pwa/core/*.js`, `backend/pwa/main.js`, `backend/pwa/index.html` (modulepreload).
Разделить удобно: `git add` коммит 1 (kit/ + перечисленное) после; остальное `backend/pwa` — коммит 2. Переименования git видит как R (старые пути — удаления, пока не добавлены).

## Риски / нужно от других
- Часть A: `design-baseline.json` содержит ключи старых путей `ui/*.js` (устаревшие записи, lint их не ругает; `--update-baseline` уберёт). Я baseline не трогал.
- Остаток: замена ~28 самодельных пустых состояний (волны 1+); `ui/kit/special/` не создавал (закрытые спец-интерфейсы не переносил); хранилище A5 (baseline аудита) не делал; прогон site-audit на стенде — нужен стенд.
- В ходе работы случайно выполнил `git stash -q` и сразу `git stash pop` — правки целы; в списке stash остались чужие записи.
