# REPORT C260 — склады через API

**Статус:** готово к приёмке. Коммита нет. Прод не трогался. C261–C265 не открывались.

**Сделано:**
- ✅ POST/PATCH/DELETE `/api/stock/warehouses` — admin/manager. Запись только через `stock-writes` и фасад `StockService`.
- ✅ Флаг `c260.warehouses.api` (сид, выкл). Вкл — API хозяин. Выкл — 409 «CRM снова может писать Mongo», маршруты не сняты.
- ✅ Один `isDefault`. Снятие — `deletedAt`. Только `$set` известных полей. `defaultWarehouse` флаг не смотрит.
- ✅ DTO whitelist. `storageitems` / движения / брони / заявки не менялись.
- ➖ Места записи CRM не снимались (чтение). Правка kppdf вне среза.

**Чтение kppdf** (`D:\invSportiN\Сайт\02_Проекты_КП\kppdf-8.0`, файлы не правились):
- `backend/src/modules/warehouse/warehouse.service.ts:28` `model.create`
- `:66` `doc.save()`
- `:72` `updateOne` `deletedAt`
- `warehouse.controller.ts:84` POST, `:96` PATCH, `:108` DELETE
- `backend/src/common/seed/warehouse.seed.ts:47` `model.create`

**Файлы:** `stock-writes.ts`, `stock-core.service.ts`, `stock.service.ts`, `stock.controller.ts`, `stock.module.ts`, `dto.ts`, `warehouse-flag.ts`, `feature-flags.seed.ts`, `stock-warehouse.spec.ts`, `docs/MAP.md`, `docs/openapi.json` (ручные операции, без регенерации контейнером).

**Проверки:** tsc 0. eslint затронутых файлов 0. jest `stock-warehouse` + `stock-writes` + `stock-correct-session` — 26/26. Full e2e нет (перед выкладкой).

**Допущение:** флаг выкл, чтобы не появился второй писатель, пока CRM не переведена. Включение — `PUT /api/feature-flags/c260.warehouses.api` с `enabledByDefault: true` (admin), отдельно от этого среза.

**Риски / другие:** снятие склада не смотрит остатки. Откат — флаг назад. Нужно от qa: full перед выкладкой. Выкладка — только отдельное «да». Право Mongo `kppdf` не снималось.
