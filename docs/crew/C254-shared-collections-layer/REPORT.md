# C254 — отчёт backend

**Статус:** C254-0 и C254-a готовы, не закоммичены. Прод не трогался. Схемы shared и kppdf не менялись. L-251/252/253 не тронуты. finance/dicts и прочие потребители не переводились.

## Подчек-лист

- [x] **C254-0** — слой чтения + контракт полей (без перевода всех потребителей)
- [x] **C254-a** — один потребитель (`partners`)
- [ ] **C254-b** — следующий (`finance` / `fill-audit`)
- [ ] **C254-c** — `dicts` и прочие по одному
- [ ] **C254-w** — запись shared только через `StockService` / `SupplyService`
- [ ] **C254-doc** — ARCHITECTURE / UNIFY

## C254-0

Контракт полей сырых проекций и `$` агрегатов шести shared — `backend/src/common/shared-collections/fields.ts`. `sharedFind` / `sharedCount` зовут `liveFilter`. Без проекции документ целиком. Чужое поле проекции — ошибка. Образец один: `disk/integrity` (фильтр уже `deletedAt: null`, проекция из контракта; `salesorders` мимо слоя). Остальные потребители не переведены. Агрегаты не обёрнуты.

**Файлы:** `fields.ts`, `read.ts`, `index.ts`, `read.spec.ts`, `modules/disk/integrity.ts`, карта backend, урок.

**Проверки:** `npx tsc --noEmit` — 0. `npx eslint` по этим файлам — 0. `npx jest --runTestsByPath src/common/shared-collections/read.spec.ts src/modules/disk/integrity.spec.ts --runInBand` — 6/6 PASS.

**Риски:** `materials.offcutOf` / `shortName` и `supplyrequests.photoIds` / `receivedAt` читаются, в схеме mongoose их нет — в kppdf не копировать (L-257). Перевод finance и прочих сменит выдачу там, где `deletedAt` не задан. Карта обновлена. Коммит: нет.

## C254-a

Сырые find/count шести shared в `partners` идут через `sharedFind` / `sharedCount`. finance, dicts и прочие не трогались.

- Карточка заявок, брони, выдачи, два счёта перед удалением: фильтр уже `deletedAt: null`, проекция из контракта. Выдача та же.
- Имя материала на выдаче раньше без `deletedAt`. Стоит `includeDeleted`: имя снятой позиции остаётся.
- Обход коллекций при удалении: у shared нет проекции. Подписи `num` / `no` / `orderNo` / `name` шире контракта (`storageitems.name`). Фильтр уже живой. Текст 409 тот же. Чужие коллекции — прежняя проекция.
- Агрегат списка поставщиков не обёрнут: слой не берёт pipeline (C254-0). `$match` уже с `deletedAt: null`.
- `updateMany` заявок и чтение в `writableCascadeRows` не тронуты (C254-w). Отдельных find `storageitems` / `warehouses` в partners нет: они только в общем обходе.

**Файлы:** `partners.service.ts`, `partners.shared-read.spec.ts`, карта, урок.

**Проверки:** `npx tsc --noEmit` — 0. `npx eslint` по этим двум файлам — 0. jest partners (5 spec) + `read.spec.ts` — 18/18 PASS.

**Риски:** обход shared читает документ целиком (лимит 6), не узкую подпись. Запись заявок по-прежнему сырая. Карта обновлена. Коммит: нет.
