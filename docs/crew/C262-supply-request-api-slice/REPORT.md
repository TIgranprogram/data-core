# REPORT C262 — заявка через API (без прихода)

**Статус:** готово к приёмке. Коммита нет. Прод не трогался. C263+ не открывались.

**Сделано:**
- ✅ POST/PATCH/DELETE `/api/supply/requests`. Запись карточки остаётся в `SupplyService` (хозяин). Справочные `supply-writes` флаг не смотрит.
- ✅ Флаг `c262.supply.requests.api` (сид, выкл). Вкл — API хозяин. Выкл — 409 «CRM снова может писать Mongo», маршруты не сняты. GET без флага.
- ✅ Пачка `createBulk` идёт через `create()` и тоже 409. Приход и откат прихода флаг не смотрит.
- ➖ Соседей не закрывал: фото, корзина, Excel, строки счёта, справочные правки. Правка kppdf вне среза.

**Чтение kppdf** (`D:\invSportiN\Сайт\02_Проекты_КП\kppdf-8.0`, файлы не правились):
- `backend/src/modules/supply/supply-request.service.ts:108` `model.create`
- `:193` `doc.save()` правка
- `:254` `updateOne` `deletedAt`
- `supply-request.controller.ts:47` POST, `:57` PATCH, `:98` DELETE
- Соседние, срез не брал: `:230` «заказано», `:239` «получено», `:248` отмена (`save`); контроллер `:68` `:78` `:88`

**Файлы:** `supply-request-flag.ts`, `supply.service.ts`, `supply.controller.ts`, `supply.module.ts`, `supply-writes.ts` (комментарий), `feature-flags.seed.ts`, спеки, `docs/MAP.md`, `docs/openapi.json` (подписи, без регенерации).

**Проверки:** tsc 0. eslint затронутых файлов 0. jest supply 239/239 (13 наборов); `supply.service` + `supply.bulk` + `stock-writes` — 109/109. Циклы: новых длинных 0. Full e2e нет (перед выкладкой).

**Допущение:** флаг выкл, чтобы не появился второй писатель, пока CRM не переведена. Включение — `PUT /api/feature-flags/c262.supply.requests.api` с `enabledByDefault: true` (admin), отдельно от этого среза.

**Риски / другие:** Excel (`supplier-excel.service.ts:169` `insertOne`), строки счёта и справочные `updateMany` пишут заявку мимо флага — не карточка этого среза. Нужно от qa: full перед выкладкой. Выкладка — только отдельное «да». Право Mongo `kppdf` не снималось.
