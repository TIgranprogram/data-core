# ТЗ SPEED-2 — скорость, пачка 2 (лёгкие запросы, фото medium, замер экранов)

**Класс:** L · backend + frontend параллельно · **Проверки:** backend tsc 0 + юнит + e2e затронутого; frontend `node --input-type=module --check`.
Источник: `docs/audit/AUDIT-ARCH.md` §2.1–2.2, §3, §4 п. 3, 4, 8 (читать только эти места). Жалоба пользователя: «с каждым днём тяжелее».

## Контракт (только новые эндпоинты и поля)
- `GET /api/me/counters` → `{ requests, stockLow, awaiting, salesorders, design, work }` (числа; ключ раздела, закрытого роли, — отсутствует). Те же значения, что сейчас считает `main.js:refreshCounts` (`counts.*` из `limit=1`-запросов: заявки активные, склад «заканчивается», `incomes` awaiting, заказы active, проектирование queue+work, «В работе» waiting+work). Склад — без полной сборки `itemRows`, если можно посчитать дешевле; если нет — из того же кэша.
- `GET /api/supply/requests/lookup?search=&limit=` → `{ items: [{ id, title, unit, article, categoryId, categoryName, supplierName, priceHint }], total }` — лёгкая подсказка «уже заказывали», без `present` (как `stock/lookup`).
- Фото: при загрузке кроме `thumb` создаётся вариант `medium` (webp, длинная сторона ≤ 1000 px, качество как у thumb). В выдаче фото (`PhotoVariantSummary`, `common/photos.ts loadPhotos`) — поле `medium` рядом с `thumb`, когда есть. Старые фото без medium — клиент берёт как раньше. Скрипт для старых фото **не писать** (отдельно, по «да» пользователя).

## Backend
- Файлы: новый `me`-контроллер (или в существующем модуле профиля — найди `/me` Grep'ом), `modules/supply` (lookup — новый метод, `present` не трогать), `modules/photos/photos.service.ts` + `common/photos.ts`, тесты, `docs/MAP.md`.
- Не трогать `backend/pwa/**`.

## Frontend
- `main.js:refreshCounts` — один `/me/counters`; нет эндпоинта (404) — старые 6 запросов.
- `sections/requests.js:119` `pastItems` — на `/supply/requests/lookup` (404 — по-старому).
- `sections/salesorders.js:~442` `/production-orders?limit=200` при открытии формы — кэш через существующий `lookups`/`core/api.js` (1–2 мин).
- `core/orders-lookup.js:28–40`, `core/stock-list.js:31` — убрать мёртвые ветки 404-fallback; `ui/bulk.js`, `ui/quick-order.js` — удалить, если Grep (в т. ч. динамические `import(`) не находит использований; затем `node backend/scripts/pwa-preload.mjs`.
- Фото в карточках и правой панели (галерея карточки, `ui/photos*` — найди Grep `thumb`/`storageUrl`): для показа крупно брать `medium`, если есть, иначе как сейчас (оригинал — только по клику «открыть оригинал»).
- Замер экранов: в `ui/list.js` — `performance.now()` от монтирования до первой отрисовки данных; если > 2000 мс — отправить вместе с ошибками сайта (найди отправку client errors — `clienterrors`, Grep в `core/`), тип `slow`, текст «Медленно: <раздел> <мс> мс». Не чаще раза в 5 минут на раздел.
- Не трогать: `sections/chat.js`, `home.js`, `order-shipments.js` без нужды.

## Приёмка
- [ ] Меню считает одним запросом; без сервера — как раньше.
- [ ] Новая загрузка фото даёт medium; карточка показывает medium.
- [ ] Медленный экран (> 2 с) попадает в ошибки сайта с типом slow.
- [ ] Проверки зелёные. Не коммитить. Отчёт ≤ 10 строк.
