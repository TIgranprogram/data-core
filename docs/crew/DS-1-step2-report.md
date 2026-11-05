# ДС-1 шаг 2 — отчёт (frontend, 2026-11-05)
Статус: готово, не закоммичено.
1. CSS ✅: `.k-hover` — `--shadow`, рамка `--border-strong`, `:active` scale(.97); полоса `card L` 4px; подъём -1px убран (k-gfold, строки в нём, `.col-body .tcard`); `.tcard` радиус `--radius`, без rgba-тени; `.tile` без тени в покое, `.tile.active` — рамка золото + `--surface`; 4 псевдонима в `tokens.css` (обе темы, цветов не добавлено). Таблица в карточке: `--cell-pad`, у последней строки линии нет.
2. kit «связи» ✅: `ui/kit/links.js` → `kit.links({items,max=5})`; сетка `minmax(min(var(--card-min),100%),1fr)` + `@container` (одна колонка <480), карточка с таблицей на всю строку, итог числом в шапке (минус красным), «Ещё N».
3. Витрина ➖: вариантов Б/В в `#kit` не было (удалять нечего); добавлен блок «Связи».
4. DESIGN ✅: §2.2 (тени, карточка, псевдонимы), §5 (наведение), §8 (строка решения).
5. site-audit ✅: `cardLookFindings` (радиус 10, рамка 1px, нет тени в покое) → правило `l`; `hoverRuleFindings` (подъём -2px и `--shadow` только у k-hover) → `r`; тест добавлен.
Проверки: `--check` js ок; pwa-import-check 0 ошибок; design-lint новых 0 (всего 6446); pwa-guards 214 зелёных; site-audit.test 9/9; preload пересобран (`index.html`).
Файлы: ui/tokens.css, ui/base.css, ui/kit/{kit.css (378 строк),index.js,links.js}, sections/kit.js (только витрина), docs/DESIGN.md, tools/site-audit.{mjs,test.mjs}, pwa/index.html (preload).
Риски: `.tcard` с радиусом 10 и `.tile.active` без золотого кольца визуально сменятся — глазами на стенде не проверено. В `git status` чужой `deploy/synology/bundle.sh` — не мой.

## Правки дизайнера (2026-11-05)
1. `--card-pad` теперь в padding `.tcard`, `.tile`, `.db-order` (радиус `.db-order` → `--radius`); на ≤720px `--card-pad: var(--s3)` (`tokens.css`). Плотные варианты (`.compact`, `.col-body .db-order`) оставлены. `--card-gap` — между карточками доски (`.col-body`) и галереи (`.gal`, там же минимум `--card-min`).
2. `.k-hover:active { scale(.97) }` перенесён внутрь `@media (hover:hover) and (prefers-reduced-motion: no-preference)`.
3. `.tile.active`: второй признак — полоса слева 3px `inset 3px 0 0 var(--gold)` (правило `l` выбранные пропускает).
Проверки: import-check 0 ошибок; design-lint новых 0 (всего 6442); pwa-guards 214; site-audit.test 9/9. Не коммичено.
