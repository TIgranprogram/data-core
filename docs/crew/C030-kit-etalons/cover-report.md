# C030 — плитка с крупным рисунком (artCover)
Статус: готово, не закоммичено.
1. kit: card S `artCover:true` (рисунок сверху 16:10 на --photo-bg, наведение с reduced-motion), `onToggle(open)` у expand; витрина #kit блок C030-1б; DESIGN §4 (строка card S) и §8 (плитка раздела).
2. Склад: плитки категорий и складов — artCover.
3. Продукция: catTile/secItem на card S + artCover + expand, tileGrid + landing; запоминание раздела (dc-prod-sec), «Весь раздел →», один раскрытый.
4. Удалены из screens.css: cat-landing/top/sec/grid/tile/art/body/name/n, sec-grid/item/tile/art/body/name/n/chev/panel*.
Kit: backend/pwa/ui/kit/index.js, ui/kit/kit.css, sections/kit.js, docs/DESIGN.md.
Экраны: backend/pwa/sections/stock.js, sections/products/landing.js, ui/screens.css.
Проверки: --check всех js ок; design-lint новых 0 (всего 6587); pwa-guards 233 ок; qa-smoke 28 экранов, сбоев 0; снимки stock/products 390 и 1280 в scratchpad (products 1280 просмотрен).
Риск: длинные названия на узких плитках режутся до 2 строк с «…» (как раньше у cat-tile); шеврон ▾ у раздела убран (раскрытие — рамкой k-open).
