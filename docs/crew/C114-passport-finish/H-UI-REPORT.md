# C114 H-UI — блок «Заполнение изделия» (2026-11-14)

- `products/fill-block.js` (новый): `fillBlock(r, ctx)` читает `GET /showcase/:id/fill-queue`. Заголовок «Заполнено N из M» + badge, полоса `miniChart`, «Начните с этого» (одна primary «Заполнить»), ещё до 3 строк (ghost), остальное — `section` «Ещё N» (свёрнута). Всё заполнено — «Готово к паспорту и техописанию». Только `seesDocs()`. Кэш 20 с по id+updatedAt; ошибка — `failBlock` с «Повторить».
- Клик: пункт паспорта → `openPassportFunnel({productId, gap})` → `funnel/index.js` ставит `fill.focusGap(gap)` после загрузки анкеты. Габариты/вес/монтаж → `patch({of:'products', open, fill:dimL|weightKg|installation})`. Состав → вкладка «Состав и работы».
- Вкладки: `tabs.js` — число пробелов у «Паспорт» и «Техописание» (когда очередь загружена; иначе прежние числа).
- Файлы: `products/fill-block.js`, `products/tabs.js` (`productTop`), `passports/funnel/open.js` (`gap`), `passports/funnel/index.js` (S.focus). Вне scope — одна строка `sections/products.js` (`card.top` → `productTop`, иначе блок не подключить над вкладками).
- Проверки: `--input-type=module --check` 5 файлов ок; pwa-preload ок; guards 299/300 — падает design-lint из-за чужих правок (`kit.js`, `guide.js`, `kit.css`: source/progress/checklist/beforeAfter не в DESIGN.md); по моим файлам замечаний нет.
- Не сделано: снимки (нет стенда) — PARTIAL; atlas-data/help-guide не правились (шаг 8 отдельно).
- Риски: `patch({fill})` на уже открытой карточке изделия может не перезапустить подсветку — проверить глазами; у «Техописание» число теперь «не хватает», а не «строк»; очередь пока только по паспорту (`scope:'passport'`), блок это пишет.
