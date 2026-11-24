# REPORT C264 — бронь и reservedQty через API

**Статус:** готово к приёмке. Коммита нет. Прод не трогался. Флаг C263 не менялся по смыслу.

**Сделано:**
- ✅ Флаг `c264.stock.reserve.api` (сид, выкл). Вкл — API хозяин `reservations` и `storageitems.reservedQty`. Выкл — 409, маршруты не сняты.
- ✅ Под флагом: список, снятие, группа, правка, выдача, выдача по заказу, запись спецификации, `move` типов reserve/unreserve.
- ✅ `salesOrderId` маршрутов не подменялся. Просмотр спецификации флаг не смотрит. Снятие из отмены позиции заказа идёт в чужой транзакции и флаг не спрашивает.
- ➖ Движение остатка (C263) и приход (C265) этим флагом не закрыты. Правка kppdf вне среза.

**Чтение kppdf** (`D:\invSportiN\Сайт\02_Проекты_КП\kppdf-8.0`, файлы не правились):
- `reservation/reservation.service.ts:25` `create` (+ `reservedQty` `:46`, `model.create` `:48`)
- `:134` `release`, `:170` `fulfill`, `:280` `remove`
- `reservation.controller.ts:34` POST, `:41` release, `:48` fulfill, `:55` DELETE
- `orderId` в CRM — строка на брони; у заявки data-core другой ключ. Маршруты приложения с `salesOrderId` оставлены.

**Файлы:** `stock-reserve-flag.ts`, `stock-reservations.service.ts`, `stock-spec.service.ts`, `stock-movements.service.ts` (только reserve/unreserve), `stock.controller.ts`, `feature-flags.seed.ts`, спеки, `docs/MAP.md`, `docs/openapi.json` (подписи).

**Проверки:** tsc 0. eslint затронутых файлов 0. jest stock/supply затронутого — 164/164 (8 наборов), вместе с C263 и C265. Циклы: новых длинных 0. Full e2e нет (перед выкладкой).

**Допущение:** флаг выкл, чтобы не появился второй писатель, пока CRM не переведена. Включение — `PUT /api/feature-flags/c264.stock.reserve.api` с `enabledByDefault: true` (admin), отдельно от этого среза.

**Риски / другие:** выдача по брони пишет и движение `out` — это один сценарий брони, флаг движения её не режет. Отмена такой выдачи — маршрут пакета (C263). Нужно от qa: full перед выкладкой. Выкладка — только отдельное «да». Право Mongo `kppdf` не снималось.
