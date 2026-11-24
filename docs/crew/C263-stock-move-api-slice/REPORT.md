# REPORT C263 — движение и остаток через API

**Статус:** готово к приёмке. Коммита нет. Прод не трогался. C264 и C265 сделаны следом, отдельными флагами.

**Сделано:**
- ✅ Флаг `c263.stock.move.api` (сид, выкл). Вкл — API хозяин `stockmovements` и `storageitems.quantity`. Выкл — 409, маршруты не сняты.
- ✅ Под флагом: `move` типов in/out/adjust/count, пакет, отмена пакета, обрезок, правка списания, отмена движения.
- ✅ Бронь (`reserve`/`unreserve`) и приход флаг не смотрит. Приход зовёт `move` с `via: 'receipt'`. Отмена внутри чужой транзакции (откат прихода, правка) флаг не спрашивает.
- ➖ Отдельного типа `transfer` в API нет. Неизвестный тип при выключенном флаге тоже 409. Правка kppdf вне среза.

**Чтение kppdf** (`D:\invSportiN\Сайт\02_Проекты_КП\kppdf-8.0`, файлы не правились):
- `stock-movement/stock-movement.service.ts:22` `create`, `:67` `model.create`, `:254` обратное `model.create`, `:255` `updateOne`
- `stock-movement.controller.ts:19` POST `stock-movements`, `:52` DELETE
- Соседние, срез не брал: бронь `reservation.service.ts`; приход заявки `supply-request.service.ts:233`

**Файлы:** `stock-move-flag.ts`, `stock-movements.service.ts`, `stock.service.ts`, `stock.controller.ts`, `feature-flags.seed.ts`, спеки, `docs/MAP.md`, `docs/openapi.json` (подписи, без регенерации).

**Проверки:** tsc 0. eslint затронутых файлов 0. jest stock/supply затронутого — 164/164 (8 наборов), вместе с C264 и C265. Циклы: новых длинных 0. Full e2e нет (перед выкладкой).

**Допущение:** флаг выкл, чтобы не появился второй писатель, пока CRM не переведена. Включение — `PUT /api/feature-flags/c263.stock.move.api` с `enabledByDefault: true` (admin), отдельно от этого среза.

**Риски / другие:** пакетное списание может уменьшить `reservedQty` своей брони — это часть движения, записи `reservations` не закрывает. Отмена пакета выдачи тоже под этим флагом: маршрут пишет остаток. Прямая поставка по счёту остаток не двигает. Нужно от qa: full перед выкладкой. Выкладка — только отдельное «да». Право Mongo `kppdf` не снималось.
