# C271 — backend, 26.11.2026

Класс L, backend-срез готов; frontend (ожидания, карточки броней, «Заказать») остаётся открытым и в выпуск не входит.

- ✅ `POST /api/stock/items/:id/request` — узкая заявка из рабочей сетки: `SupplyStockRequestController` в `SupplyModule`, роли `admin|manager`, раздел stock и StockScope, флаг `c262.supply.requests.api`. Пишет только `supplyrequests` через `SupplyService.createStockRequest`; ответ без цены/поставщика/даты/ paid; `clientUid` — строгий UUID v4, идемпотентность по `(actor, UUID, материал)`, конфликт при изменении qty/UUID; 400/403/404/409 по проверкам.
- ✅ `GET /api/stock/items/:id/reservations` — адресные активные брони материала: `StockService.itemReservations`, DTO `page`/`limit` (1…100), `total` по конкретному `materialId` в scope, безопасная проекция заказа (`orderNo/title/stage/deletedAt`) и `hanging`. Старый общий `GET /api/stock/reservations` не задет; цикла Stock↔Supply нет.
- ✅ Тесты: `supply.service.spec.ts` + `stock-reservations.service.spec.ts` — 25 юнит-провок; адресный `worker-stock-context.e2e-spec.ts` — 3 сценария (создание/идемпотентность/валидация/scope, флаг off, пагинация/поля/scope, старый список); полный e2e — см. последнюю строку `docs/TEST-LOG.md`.
- ✅ Контракт: `docs/openapi.json` перегенерирован (+2 пути), `docs/MAP.md` обновлён. Схемы CRM, индексы и глобальные guard'ы не менялись; прод-данные тестами не тронуты (изолированная `datacore-test*`).
- ➖ Frontend C271 — в `docs/TASKS.md` отдельным открытым пунктом; визуальная приёмка/стенд — координатор.
- Якоря: `supply-stock-request.controller.ts:18`, `supply-stock-request.dto.ts:4`, `supply.service.ts:501`, `stock.controller.ts:31`, `stock-item-reservations.dto.ts:7`, `stock-reservations.service.ts:39`.
