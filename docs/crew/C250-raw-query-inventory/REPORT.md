# C250 — отчёт backend

**Статус:** готово, не закоммичено. Рантайм не менялся: существующих вызовов на хелпер нет (0 образцов).

**Сделано:** A ✅ `INVENTORY.md` — девять коллекций, писатели и читатели, способ (`db.collection` / своя и чужая Mongoose-модель / scripts / admin). `bulkWrite` по ним нет. B ✅ `backend/src/common/raw-query.ts` — `liveFilter`, `rawFind`, `rawCount`, `rawAggregate`: по умолчанию `deletedAt: null`, `includeDeleted`, явный `deletedAt` не перетирается. CHECKLIST не трогал.

**Файлы:** `docs/crew/C250-raw-query-inventory/INVENTORY.md`, `REPORT.md`, `backend/src/common/raw-query.ts`, `raw-query.spec.ts`, якоря в `docs/roles/maps/backend.md`.

**Проверки:** `npx tsc --noEmit` — 0. `npx jest --runTestsByPath src/common/raw-query.spec.ts --runInBand` — 5/5 PASS.

**Риски / другим:** чужие записи мимо хозяина живые (склад пишет `materials`, витрина и паспорта пишут `products`, `salesorders.service` пишет `incomes`, `income-cancel` пишет `reservations` и `supplyrequests`, справочники делают `updateMany`). Shared-коллекции ещё пишет kppdf — в обход не смотрел. Перевод на хелпер отдельно: фильтр сменит выдачу там, где сейчас `deletedAt` не задан. Карта обновлена. Коммит: нет.
