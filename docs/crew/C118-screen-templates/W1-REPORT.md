# C118 W1 — отчёт

1. DESIGN.md §3.1 «Шаблоны экранов» — 7 шаблонов, закон информационной архитектуры (7 пунктов); в §3 история карточки — вкладка `card-tabs`.
2. `atlas-data.js`: у 27 блоков `tpl` + `tplStatus` (21 legacy, 6 plan, ok нет).
3. `tools/dc.mjs atlasCheck`: нет/неверный `tpl` или `tplStatus` — ошибка; legacy > `tools/tpl-baseline.json` (21) — ошибка; меньше — напоминание снизить.
4. Строка-ссылка в `CLAUDE.md` и `AGENTS.md`.
Проверки: `--check` модулей, `dc atlas --check` (структура в порядке), pwa-guards 303/303.
Допущение: tpl — на уровне блока карты (экран = блок), не вкладки.
5. (доп. владельца) DESIGN §3.2 — каталог именованных блоков-эталонов: 8 блоков, русское имя + функция (infoCard, nextCard, warnCard, positionsTable, rowCard, filterBar, progressBar, historyBlock), статус есть/нет. Есть: warnCard (=noticeCard), rowCard, filterBar; нет: infoCard, nextCard, positionsTable, progressBar, historyBlock (план, `ui/kit/screens/blocks.js`).
