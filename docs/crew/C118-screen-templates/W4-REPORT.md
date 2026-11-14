# W4 — доска и вход в паспорта

## Файлы kit (коммит 1)
- `backend/pwa/ui/kit/screens/blocks.js` — `boardCard({pic,title,hint,sub,extra,flags,meta,compact})` → тело карточки доски (классы t-title/t-sub/t-foot/t-main, CSS не менялся).
- `backend/pwa/sections/kit.js` — витрина `#kit` «Карточка доски · boardCard».
- `docs/DESIGN.md` §3.2 — строка «Карточка доски».

## Файлы экранов (коммит 2)
- `sections/salesorders.js` boardBody, `sections/work.js` boardBody, `sections/design.js` boardBody, `sections/requests.js` board.card — через boardCard (кнопка шага осталась в card.foot).
- Склад: доска не используется (плитки/таблица, `gallery.card`) — не менялся.
- 1.6: `sections/salesorders-next.js passportsStep` — кнопка «Паспорта заказа» на доске ведёт в карточку заказа, вкладка «Документы» (`#salesorders?open=<key>&tab=pass`), а не в панель docs `orderpass`; тест обновлён. Реестр «Документация → Паспорта по заказам» (`docs-orders.js`) и «К паспортам заказа» в `docs.js` оставлены (список/возврат, не своё окно).

## Проверки
--check всех файлов ok; node --test salesorders-next 2/2; pwa-guards 307/307; design-lint 0.
Глазами не смотрено (доска заказов/проектирования/работы/заявок — снимки нужны координатору).
