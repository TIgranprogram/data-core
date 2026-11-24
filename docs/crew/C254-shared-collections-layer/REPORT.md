# C254 — отчёт backend

**Статус:** C254-0, C254-a, C254-b, C254-c и C254-w готовы, не закоммичены. Прод не трогался. Схемы shared и kppdf не менялись. L-251/252/253 не тронуты. C254-doc не делался.

## Подчек-лист

- [x] **C254-0** — слой чтения + контракт полей (без перевода всех потребителей)
- [x] **C254-a** — один потребитель (`partners`)
- [x] **C254-b** — `finance` и `fill-audit`
- [x] **C254-c** — `dicts` и прочие сырые find/count вне stock/supply
- [x] **C254-w** — запись shared только через `StockService` / `SupplyService`
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

## C254-b

Сырые find/count шести shared в `finance` и `fill-audit` идут через `sharedFind` / `sharedCount`. partners, dicts и прочие не трогались. Записи incomes/salesorders/products и shared не менялись.

- В `finance` читаются только `supplyrequests`. Остальные пять shared там не читаются. Фильтры уже с `deletedAt: null`, проекции из контракта (`photoIds` тоже). Выдача та же.
- Связь снимка оплаты раньше без `deletedAt` (поле ещё и в проекции). Стоит `includeDeleted`: снятая заявка по-прежнему даёт статью и строку.
- `distinct` счетов в `needsFill` и `lockedInvoices` мимо слоя: у слоя нет distinct. Фильтр уже живой.
- Агрегат сверки артикула в `fill-audit` мимо слоя (C254-0). `$match` уже с `deletedAt: null`. Два find материалов — через слой, фильтр живой, проекция из контракта.
- Группы «Требуют заполнения» по `supplyrequests` и `materials`: без проекции, документ целиком (фото и подписи). Фильтр уже живой. Чужие коллекции — прежний find/count.
- `storageitems` в fill-audit только в списке кэша, отдельного find нет. `docScopeMatch` (materials) живёт в `supply-scope` — это не эти модули, оставлен на C254-c.
- `updateOne` классификации и чтение incomes/salesorders не тронуты (C254-w, L-251/252).

**Файлы:** `finance.service.ts`, `finance-visibility.ts`, `financial-classification.service.ts`, `fill-audit.service.ts`, два spec, карта, урок.

**Проверки:** `npx tsc --noEmit` — 0. `npx eslint` по этим шести файлам — 0. jest finance (6 spec) + fill-audit (2) + `read.spec.ts` — 66/66 PASS.

**Риски:** distinct и агрегат shared всё ещё сырые. Запись заявок в классификации по-прежнему сырая (ветка не editable). Карта обновлена. Коммит: нет.

## C254-c

Сырые find/count шести shared вне `stock/` и `supply/` идут через `sharedFind` / `sharedCount`. partners, finance, fill-audit не трогались. Записи shared и incomes/salesorders/products не менялись.

- `dicts`: find/count materials, supplyrequests, stockmovements. Фильтры уже с `deletedAt`. Имя материала на выдаче сотруднику — `includeDeleted` (`dicts.defs.ts:729`). У отделов проекция `num`/`title` вне контракта движений — документ целиком (`sharedOpts`, `:134`).
- `supply-scope`: оба чтения materials с `includeDeleted` (`supply-scope.ts:17`, `:29`). Снятая позиция не выпадает из склада.
- Прочие: showcase, salesorders, order-history, today, control, category, stock-zones, financial-article-writer, module-work-release, income-cancel, work-route, composition-expand, catalog-references, zone-events, предпросмотр слияния. Где `deletedAt` не было — `includeDeleted`.
- Без проекции, поля вне контракта: бронь `expiresAt`/`zoneName` и ячейка `isActive`/`minQuantity` (`zone-events.ts:39`, `:62`); бронь `salesOrderLineId` (`income-cancel.service.ts:48`); `materials.workTypes` (`work-route.service.ts:73`); `passportSpec`/`composition` (`composition-expand.ts:232`).
- Сырыми остаются агрегат и distinct: `tally` справочников (`dicts.defs.ts:139`), счётчики категорий, кандидаты «кто подал», агрегат себестоимости витрины, агрегат «сегодня», distinct finance и агрегат fill-audit/partners. Слой их не берёт.
- `stock/` и `supply/` (включая каталог поставщика) не эта поставка: хозяева и соседние чтения склада.

**Файлы:** перечисленные модули, `dicts.shared-read.spec.ts`, `supply-scope.shared-read.spec.ts`, карта, урок.

**Проверки:** `npx tsc --noEmit` — 0. jest dicts 16 файлов — 88/88 PASS; income-cancel, questions, today, control, catalog-guards, composition-expand, zones, stock-zones, category, salesorders, order-history, showcase-composition, work, financial-article-writer, read.spec, supply-scope — PASS. Новых предупреждений eslint нет (старые `any` в salesorders и financial-article-writer).

**Риски:** агрегат и distinct shared сырые. Запись shared сырая (C254-w). Чтения внутри stock/supply сырые. Карта обновлена. Коммит: нет.

## C254-w

Сырая запись шести shared в рантайме вне `stock/` и `supply/` ушла в хозяина. Внутри `stock/` и `supply/` запись осталась (модель и `db.collection`, включая `supplier-excel` `insertOne`). Чтения не переводились. L-251/252/253 не менялись: incomes/salesorders/products по-прежнему через свои writes.

- Заявки: `supply-writes.ts`. Справочники, партнёры и перенос позиции зовут `common/supply-owner-port.ts` (прямой импорт supply замыкает цикл).
- Склад и материалы: `stock-writes.ts`. Карточка материала и цена — через `common/stock-owner-port.ts` (stock уже импортирует схему материала). PDM и перенос брони импортируют `stock-writes` напрямую. Справочник движений и позиций — тоже.
- Классификация: старая заявка без счёта по-прежнему `editable: false`. Перед чужим `updateOne` стоит отказ, если коллекция из шести shared.

**Grep:** `collection('materials'|storageitems|stockmovements|reservations|warehouses|supplyrequests).(insert|update|delete|findOneAnd|replace|bulkWrite)` в `backend/src` вне `stock/` и `supply/` — 0. `model.create|updateOne|findOneAndUpdate` материалов вне этих папок и портов — 0.

## Белый список scripts

Разовые, не Nest. Не переводились.

| Кто | Коллекции |
|--|--|
| `backfill-materialprices.js`, `clean-auto-articles.js`, `material-passport-spec-fill.js`, `fill-material-dims.js` | materials |
| `stock-dedupe-bolts.js` | materials, storageitems, stockmovements, supplyrequests |
| `invoices-from-requests.js`, `link-requests-materials.js`, `map-articles.js`, `merge-duplicate-invoices.js` | supplyrequests |
| `scripts/archive/c057-kind.js`, `c057-parse-names.js`, `c057-profiles.js`, `fix-bolt-photos.js` | materials |
| `ensure-indexes.js` | индексы, не документы |
| админка «Таблицы» | как C250: документы этих шести не пишет |
| kppdf | вне data-core |

**Файлы:** `stock-writes.ts`, `supply-writes.ts`, порты, dicts, partners, income-cancel, material, material-price, pdm-import, pdm-preview, financial-classification, карта, урок.

**Проверки:** `npx tsc --noEmit` — 0. eslint по этим файлам — 0. jest stock-writes, dicts rename/metal/materials-spec, partners.merge, income-cancel, material (3), pdm-import (2), finance.shared-read — PASS. `node scripts/audit-cycles.js` — новых циклов 0, пар 0.

**Риски:** запись внутри stock/supply по-прежнему и моделью, и сырым `db.collection`. Классификация не пишет shared, отдельного адаптера заявки нет. Карта обновлена. Коммит: нет.
