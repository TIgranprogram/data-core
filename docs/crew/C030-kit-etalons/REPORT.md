# C030 — 5 экранов на эталоны kit — PASS

Все замены — строго по SPEC §4; поведение, тексты, обработчики и запросы не менялись. После каждого экрана: `--check` ок, линтер «Итого новых: 0», `--update-baseline` (вниз).

| Экран | L3 до → после | Что сделано |
|--|--|--|
| home.js | 65 → 8 | section fixed/urgent/more, stack, row, stat-пилюли, tabs days, miniChart(bar), card S + tileGrid, toolbar, layout.cols, busyBlock, hint() |
| stock.js | 32 → 0 | card S art/low/expand + tileGrid + landing, row (история движений), badge (бронь/висит/нерж./мытая), колонки pic/nowrap, posPic, empty |
| supplier-catalog.js | 35 → 0 | navList (Быстро/Порядок), card S art + landing, card M fields + readonlyGroup, badge warn (устарела), toolbar, hint(), posPic, section (предпросмотр) |
| dicts.js | 32 → 0 | layout.split + navList (группы, fold «Документы»), toolbar + h2 + hint(), row (список, кандидаты lead=чекбокс), actions, badge dot (цвет), photoStrip, empty |
| salesorders.js | 24 → 0 | card L head+tabs (группа-договор), row (выбор договоров, готовность, выдано/заявки/движения), badge, toolbar (+Позиция/+Договор), op-act → переменная |

- Итог линтера: 7113 → 6715; «Итого новых: 0» на каждом шаге. Оставшиеся L3 в home.js: td-scope/td-pulse/td-head/td-bellwrap (обёртки, нет в SPEC §4), td-spark/td-zero/td-line (miniChart spark не берёт отрицательный баланс денег — оставлен свой SVG), td-tiles (не флаговался раньше в SPEC, сетка метрик).
- Допущения (взяты из SPEC, вид проверит дизайнер): карта тонов мини-графиков s1–s4 → info/warn/ok/dim и точек недели по видам дел; у зон склада card S expand — плитки раскрываются независимо (было «аккордеон»), основной склад открывается программным click(); у группы-договора chip-вкладки видны и при единственной вкладке; dicts на телефоне — кнопка layout.split вместо select; «Свернуть» у ленты «ещё N» осталось (section more из SPEC не даёт свернуть).
- Обход стенда: qa-smoke — 28 экранов, сбоев 0 (стенд сборки до правок; мои изменения на стенд не выкладывались — сервер не трогал).

- Рядом лежит [CAT-ART-BRIEF.md](CAT-ART-BRIEF.md) — рисунки категорий: как сейчас (cat-art.js), перечень 39 сцен и готовый промпт для дизайнера (Часть 2 копируется в чат дизайнера).
