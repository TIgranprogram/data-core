# Аккордеон плиток expand (2026-11-07)
- kit: `ui/kit/blocks.js` — tileGrid переносит панели .k-expand в конец сетки (под весь ряд), accordion() на tileGrid и landing закрывает прочие открытые по событию `k-expand-open`; `ui/kit/index.js` expandTile — id панели, aria-controls, событие; `docs/DESIGN.md` §8 стр. 109.
- экраны: `sections/stock.js` (убран авто-click «Основного»); `sections/products/landing.js` (убран ручной аккордеон, sessionStorage для «назад» оставлен).
- Прежние вызовы не ломаются; опции нет — поведение по умолчанию. Enter/Space — через cardBase.
- Проверки: --check 4 файла ок; design-lint новых 0; qa-smoke 28/0; клик по двум плиткам → открыта 1 (stock, products). Снимки stock/products 0/1 — в scratchpad.
- Риск: в «Продукции» два tileGrid (3 + «Другие разделы») — панель под своим рядом; аккордеон общий (landing).
