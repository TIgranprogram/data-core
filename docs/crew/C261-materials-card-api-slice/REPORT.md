# REPORT C261 — карточка материала через API

**Статус:** готово к приёмке. Коммита нет. Прод не трогался. C262+ не открывались.

**Сделано:**
- ✅ POST/PATCH/DELETE `/api/materials` и копия. Запись карточки через `stock-writes` / порт и `MaterialService`.
- ✅ Флаг `c261.materials.card.api` (сид, выкл). Вкл — API хозяин. Выкл — 409 «CRM снова может писать Mongo», маршруты не сняты. GET без флага.
- ✅ `$set` только известных полей. `stockQty` / `quantity` в правку не попадают. При создании по-прежнему пишется `stockQty: 0`.
- ✅ Состав, паспорт, история цен (`materialprices` / `lastPrice`) флаг не смотрит.
- ➖ Места записи CRM не снимались (чтение). Правка kppdf вне среза.

**Чтение kppdf** (`D:\invSportiN\Сайт\02_Проекты_КП\kppdf-8.0`, файлы не правились):
- `backend/src/modules/material/material.service.ts:40` `model.create`
- `:195` `findOneAndUpdate` `$set`
- `:262` `updateOne` `deletedAt`
- `:286` копия `model.create`
- `material.controller.ts:98` POST, `:103` PATCH, `:109` DELETE, `:115` копия
- `mutation-journal.service.ts:423` create, `:433` update, `:496` remove, `:502` откат update
- Соседние, срез не брал: состав `:98`/`:127`/`:146`; `import-jobs.service.ts:108`; `local-demo.seed.ts:112`

**Файлы:** `material-card-flag.ts`, `material.service.ts`, `material.controller.ts`, `material.module.ts`, `stock-writes.ts`, `stock-owner-port.ts`, `feature-flags.seed.ts`, спеки, `docs/MAP.md`, `docs/openapi.json` (подписи, без регенерации).

**Проверки:** tsc 0. eslint затронутых файлов 0 ошибок. jest material + stock-writes + catalog-delete-guards — 122/122 (11 наборов). Циклы: новых длинных 0. Full e2e нет (перед выкладкой).

**Допущение:** флаг выкл, чтобы не появился второй писатель, пока CRM не переведена. Включение — `PUT /api/feature-flags/c261.materials.card.api` с `enabledByDefault: true` (admin), отдельно от этого среза.

**Риски / другие:** каталог склада и PDM по-прежнему пишут `materials` мимо флага — не карточка этого среза. Нужно от qa: full перед выкладкой. Выкладка — только отдельное «да». Право Mongo `kppdf` не снималось.
