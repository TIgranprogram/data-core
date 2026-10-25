# Карта роли frontend

коммит: 61b18c6 (+ правки ПРЖ-5 не закоммичены)

- `backend/pwa/ui/board.js` — доска: поля `board.default/cls/headCount/add`, колонки `compact/portion/per`, карточка `{ body }`; `ui/list.js` — `board.default`, `onTotal`.
- `backend/pwa/sections/design.js` — «Проектирование» (доска + таблица, форма в правой панели, `moveTask`); `sections/order-design.js` — блок в карточке заказа (from-order).
- `ui/badges.js` — `DESIGN_STATUS`, `ORDER_PRIORITY`; `sections/salesorders.js` — приоритет заказа (форма, список, доска), `orderDesign`.
- Регистрация нового раздела: `main.js` (SECTIONS, NAV, group, refreshCounts, `clear` в syncCard) + `node backend/scripts/pwa-preload.mjs`. Jest в worktree не стоит (нет node_modules).
- Правка CRLF-файлов: скриптом node (replace \r\n → \n → правка → обратно); python нет.
