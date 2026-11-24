# C250 — писатели и читатели (снимок кода, без перевода вызовов)

Дата: 2026-11-24. Обход `backend/src`, `backend/scripts`, `backend/admin`. Тесты (`*.spec.ts`, e2e) не считаются писателями. Копии в `tools/logs` и `tools/.night` — не рантайм, в таблицу не входят.

**Способ:** `db.collection` — сырой драйвер; `своя Mongoose-модель` — `@InjectModel` в модуле-хозяине; `чужая Mongoose-модель` — та же модель из другого модуля; `scripts` — ручной скрипт; `admin` — экран «Таблицы». **`bulkWrite` по этим девяти коллекциям в data-core нет** (ни сервис, ни скрипт, ни админка).

**Хозяин записи** (решение C246, не код этого этапа): incomes → `incomes`; salesorders → `salesorders`; products → `product`; materials → `material`; storageitems / stockmovements / reservations / warehouses → `stock`; supplyrequests → `supply`.

**Вне data-core:** `materials`, `storageitems`, `stockmovements`, `reservations`, `warehouses`, `supplyrequests` — `kind: shared`. kppdf пишет их напрямую в ту же Mongo. Это отдельный писатель; файлы CRM здесь не разбирались.

**Админка:** `collections-admin.controller` читает любую коллекцию сырым `find` / `count` (в том числе все девять), без фильтра soft-delete. `DELETE` дропает только `kind: app`. Эти девять из админки не удаляются и по документам не пишутся. Строка одна на коллекцию: R, способ `admin`.

**Индексы, не документы:** `backend/scripts/ensure-indexes.js` (`--apply`) — `createIndexes` моделей Income, SalesOrder, SupplyRequest, Material, StorageItem, StockMovement, Reservation и сырые индексы `products`, `materials`, `stockmovements`, `reservations`. `c164-source-indexes.js` — индексы `salesorders` и `incomes`.

Дыры статического обхода, проверенные вручную: `salesorders.service` `incomes()`, `work-facts.service` / `order-line-plan.service` `products()`, `pdm-preview` (модель по виду), `income-cancel` `coll(name)`, `dicts` `reassign` со переменным именем коллекции, `passport-field-promote`, `module-work-release`, `stock-dedupe-bolts` `REFS`.

## Писатели (документ)

| Кто | Коллекция | R/W | Способ |
|--|--|--|--|
| `incomes/incomes.service` | incomes | R+W | своя Mongoose-модель (`create`, `updateOne`, чтение) |
| `incomes/income-payment-identities.service` | incomes | R+W | своя Mongoose-модель (`updateOne`) |
| `incomes/income-cancel.service` | incomes | R+W | db.collection (`updateOne`: отмена, возврат, перенос) |
| `salesorders/salesorders.service` | incomes | R+W | db.collection (`updateMany` кэш шапки и корзина вместе с заказом, `updateOne` сопоставление) |
| `matching/matching.service` | incomes | R+W | db.collection (`updateOne`) |
| `partners/partners.service` | incomes | R+W | db.collection (`updateMany`) |
| `showcase/showcase.service` | incomes | R+W | db.collection (`updateMany`) |
| `product-requests/product-requests.service` | incomes | R+W | db.collection (`updateOne`, `updateMany`) |
| `dicts/dicts.defs` | incomes | R+W | db.collection (`updateMany` форма оплаты) |
| `common/passport/line-source` | incomes | R+W | db.collection (`updateOne`) |
| `product-passport/passport-source.service` | incomes | W | db.collection (`updateOne`) |
| `finance/financial-classification.service` | incomes | R+W | db.collection (`updateOne` по `target.collection`, оплата позиции) |
| `salesorders/salesorders.service` | salesorders | R+W | своя Mongoose-модель (`create`, `updateOne`) |
| `salesorders/production-orders.service` | salesorders | R+W | своя Mongoose-модель (`updateOne`, `updateMany`) |
| `salesorders/order-acts.controller` | salesorders | R | своя Mongoose-модель (`aggregate`) |
| `salesorders/order-archive.service` | salesorders | R+W | db.collection (`updateOne`) |
| `salesorders/order-link` | salesorders | W | db.collection (`findOneAndUpdate` upsert по `importKey`) |
| `common/order-archive/write` | salesorders | R+W | db.collection (`updateOne`) |
| `shipments/shipments.service` | salesorders | R+W | db.collection (`updateOne`) |
| `partners/partners.service` | salesorders | R+W | db.collection (`updateMany`) |
| `dicts/dicts.defs` | salesorders | W | db.collection (`updateMany` форма оплаты) |
| `product/product.service` | products | R+W | своя Mongoose-модель (`create`, `findOneAndUpdate`, `updateOne`) |
| `pdm-import/pdm-import.service` | products | R+W | чужая Mongoose-модель (`updateOne`) |
| `pdm-import/pdm-preview.service` | products | R+W | чужая Mongoose-модель (`findOne`, `updateOne` фото) |
| `design/design.service` | products | R+W | db.collection (`updateOne`) |
| `dicts/dicts.defs` | products | R+W | db.collection (`updateMany`: серия, состав, размеры паспорта) |
| `dicts/dicts.passport-kinds` | products | R+W | db.collection (`updateMany`) |
| `dicts/dicts.passport-phrases` | products | R+W | db.collection (`updateMany`) |
| `dicts/dicts.product-groups` | products | R+W | db.collection (`updateMany` группа) |
| `dicts/dicts.product-facets` | products | R+W | db.collection (`updateMany` признаки) |
| `matching/matching.service` | products | R+W | db.collection (`updateOne`) |
| `order-line-plan/order-line-plan.service` | products | R+W | db.collection (`updateOne` виды работ) |
| `order-line-plan/work-facts.service` | products | R+W | db.collection (`updateOne` виды работ) |
| `product-passport/passport-import.service` | products | R+W | db.collection (`updateOne`) |
| `product-passport/passport-product-write` | products | R+W | db.collection (`updateOne`) |
| `product-passport/passport-field-promote` | products | R+W | db.collection (`updateOne`) |
| `product-photo/product-photo.service` | products | W | db.collection (`updateOne`) |
| `showcase/passport-template-patch` | products | R+W | db.collection (`updateOne`) |
| `showcase/showcase-bulk` | products | R+W | db.collection (`updateOne`) |
| `showcase/showcase-composition` | products | R+W | db.collection (`updateOne`) |
| `showcase/showcase-from-passports` | products | R+W | db.collection (`updateOne`) |
| `showcase/showcase.service` | products | R+W | db.collection (`insertOne`, `updateOne`) |
| `work/work-route.service` | products | R+W | db.collection (`updateOne`) |
| `work/module-work-release` | products | R+W | db.collection (`updateOne` состав, если хозяин строки — изделие) |
| `material/material.service` | materials | R+W | своя Mongoose-модель (`create`, `findOneAndUpdate`, `updateOne`) |
| `material/material-price.service` | materials | R+W | своя Mongoose-модель (`updateOne`; тот же модуль) |
| `stock/stock-catalog.service` | materials | R+W | чужая Mongoose-модель (`create`, `updateOne`, в том числе `deletedAt`) и db.collection (`updateOne` артикул) |
| `stock/stock-bulk` | materials | R+W | db.collection (`updateOne`) |
| `stock/stock-core.service` | materials | R+W | db.collection (`updateOne`) |
| `stock/stock-movements.service` | materials | R+W | db.collection (`updateOne`, `updateMany`: `editedInApp`, `offcutOf`) |
| `stock/stock-reservations.service` | materials | R+W | db.collection (`updateMany` `editedInApp`) |
| `pdm-import/pdm-import.service` | materials | R+W | чужая Mongoose-модель (`create`, `updateOne`) |
| `pdm-import/pdm-preview.service` | materials | R+W | чужая Mongoose-модель (`updateOne` фото) |
| `dicts/dicts.defs` | materials | R+W | db.collection (`updateMany`: поля справочника, категория, единица) |
| `stock/stock-core.service` | storageitems | R+W | своя Mongoose-модель (`create`) и db.collection (`updateMany` в том же модуле) |
| `stock/stock-catalog.service` | storageitems | W | своя Mongoose-модель (`updateOne`, `updateMany`) |
| `stock/stock-movements.service` | storageitems | R+W | db.collection (`updateOne` `lastCountedAt`; тот же модуль) |
| `stock/stock-movements.service` | stockmovements | R+W | своя Mongoose-модель (`create`, `updateOne`) |
| `stock/stock-reservations.service` | stockmovements | R+W | своя Mongoose-модель (`create`) |
| `dicts/dicts.defs` | stockmovements | R | db.collection (чтение); **W** `updateMany` при объединении «Отделы» (`issuedTo`) и «Причины списания» (`reason`) — имя коллекции в `simpleList`, не литерал рядом с вызовом |
| `stock/stock-movements.service` | reservations | R+W | своя Mongoose-модель (`create`) |
| `stock/stock-reservations.service` | reservations | R+W | своя Mongoose-модель (`create`) |
| `stock/stock-spec.service` | reservations | R+W | своя Mongoose-модель (`create`) |
| `incomes/income-cancel.service` | reservations | R+W | db.collection (`updateMany` `salesOrderId` при переносе позиции; снятие брони — через `StockService`, не прямой записью) |
| `stock/stock-core.service` | warehouses | R+W | своя Mongoose-модель (`create`, `updateOne`) |
| `supply/supply.service` | supplyrequests | R+W | своя Mongoose-модель (`create`, `updateOne`, в том числе `deletedAt`) |
| `supply/supply-invoice.service` | supplyrequests | R+W | своя Mongoose-модель (`updateOne`, `updateMany`) |
| `supply/supply-invoice-payments.service` | supplyrequests | R+W | своя Mongoose-модель (`updateMany`) |
| `supply/supply-invoice-intake.service` | supplyrequests | R+W | своя Mongoose-модель (`insertMany`) |
| `supply/supply-undated-payments.service` | supplyrequests | R | своя Mongoose-модель |
| `supply/supplier-excel.service` | supplyrequests | R+W | db.collection (`insertOne`; модуль хозяина, мимо модели) |
| `incomes/income-cancel.service` | supplyrequests | R+W | db.collection (чтение зависимостей, `updateMany` `salesOrderId` при переносе) |
| `partners/partners.service` | supplyrequests | R+W | db.collection (`updateMany`) |
| `dicts/dicts.defs` | supplyrequests | R+W | db.collection (`updateMany`: категория, единица, кто запросил, тип счёта) |
| `finance/financial-classification.service` | supplyrequests | R | db.collection (старая заявка без счёта: `editable: false`, до `updateOne` не доходит) |
| kppdf (вне репозитория) | materials, storageitems, stockmovements, reservations, warehouses, supplyrequests | W | прямой Mongo, не data-core |
| `admin` `collections-admin` | все девять | R | admin (сырой `find`; дроп коллекции запрещён) |

Чужие Mongoose-модели **только читают** (записи нет): `catalog-graph` (products, materials), `product-module` (products, materials), `productattachments` (products `exists`, incomes `findOne`), `purchase-needs` (materials), `qr` (products и materials, `includeSoftDeleted`), `stock-search` / `stock-spec` (materials), `product.service` держит `Material` для проверки состава, сам поля материала не пишет.

## Скрипты (документ, запуск вручную; план / `--apply` где так устроен скрипт)

| Скрипт | Коллекция | R/W | Способ |
|--|--|--|--|
| `scripts/import-orders-xlsx.js` | incomes, salesorders | R+W | scripts (`insertOne`, `updateOne`) |
| `scripts/incomes-payments-migrate.js` | incomes | R+W | scripts (`updateOne`) |
| `scripts/add-our-company.js` | incomes, salesorders | R+W | scripts (`updateMany` / `updateOne`) |
| `scripts/order-archive-write.js` | salesorders | R+W | scripts (`updateOne`); incomes только чтение |
| `scripts/import-catalog-photos.js` | products | R+W | scripts (`insertOne`, `updateOne`) |
| `scripts/c094-materials.js`, `c103-own-types.js`, `c106-clear-c062.js`, `c106-restore-doubtful.js`, `c112-a2-gone-choices.js`, `iz21-regroup.js`, `names-migrate.js`, `passport-category-defaults.js`, `passport-category-groups.js`, `products-category-from-passports.js`, `products-fill-defaults.js` | products | R+W | scripts (`updateOne`) |
| `scripts/passport-dicts-cleanup.js` | products | R+W | scripts (`updateOne`; имя коллекции в переменной) |
| `scripts/merge-product-category.js` | products | R+W | scripts (`updateOne` по `ops.coll`) |
| `scripts/backfill-materialprices.js`, `clean-auto-articles.js`, `material-passport-spec-fill.js`, `fill-material-dims.js` | materials | R+W | scripts (`updateOne`) |
| `scripts/stock-dedupe-bolts.js` | materials, storageitems, stockmovements, supplyrequests | R+W | scripts (`updateOne` / `updateMany`; движения и заявки — `REFS`) |
| `scripts/invoices-from-requests.js`, `link-requests-materials.js`, `map-articles.js`, `merge-duplicate-invoices.js` | supplyrequests | R+W | scripts (`updateOne` / `updateMany`) |
| `scripts/archive/match-legacy-exact.js` | incomes | R+W | scripts (архив) |
| `scripts/archive/migrate-maf-to-blg.js`, `passport-fields-to-product.js`, `passport-install-method.js` | products | R+W | scripts (архив) |
| `scripts/archive/c057-kind.js`, `c057-parse-names.js`, `c057-profiles.js`, `fix-bolt-photos.js` | materials | R+W | scripts (архив) |

Остальные попадания скриптов в эти коллекции — чтение или только индексы (`ensure-indexes`, `c164-source-indexes`). `c169-intake-indexes` эти девять не трогает.

## Только чтение (сервисы)

Способ везде `db.collection`, кроме пометок «модель».

| Коллекция | Кто |
|--|--|
| incomes | `legal-utils`, `order-archive/cascade`, `order-archive/write`, `production-seq`, `design-board`, `design-present`, `design-write`, `design.service`, `finance.service`, `financial-operations-reader`, `match-facts`, `my-tasks`, `offers`, `order-line-plan` (`order-line-plan`, `plan-write`, `task-bars`, `work-facts`, `work-schedule`), `customer-names`, паспорта (`passport-bind`, `passport-import`, `passport-order`, `passport-queue`, `passport-ready`, `passport-registry`, `product-fill-queue`, `product-passport`), `income-attachments` (чужая модель), `order-history`, `production-orders`, `shipments`, `stock-composition`, `stock-reservations`, `stock-summary`, `stock-target`, `supply.service` (счётчик), `module-work-release`, `work-media`, `work-present`, `work.service`, `zone-events` |
| salesorders | `order-archive/cascade`, `line-source`, `production-seq`, `control.collect`, `design-board`, `design-present`, `design.service`, `expenses`, `finance.service`, `financial-classification` (проверка объекта), `financial-operations-reader`, `incomes.service`, `matching`, `offers`, `task-bars`, `work-schedule`, `customer-names`, паспорта (`passport-bind`, `passport-import`, `passport-order`, `passport-queue`, `passport-ready`, `passport-registry`, `product-passport`), `product-requests`, `stock-hanging`, `stock-reservations`, `stock-summary`, `stock-target`, `supply-invoice`, `supply.service`, `today`, `module-work-release`, `work-present`, `work.service`, `zone-events` |
| products | `catalog-graph` (чужая модель), `photos`, `category`, `design-board`, `design-present`, `incomes.service`, `offer-photos`, `work-schedule`, `product-module` (чужая модель, `findById`), паспорта (чтение: `passport-bind`, `passport-field-promote` ещё и пишет — см. писателей, `passport-from-product`, `passport-funnel`, `passport-gaps`, `passport-order`, `passport-pdf`, `passport-queue`, `passport-ready`, `passport-registry`, `passport-source`, `product-fill-queue`, `product-passport`, `techsheet-analogs`, `techsheet-gaps`), `product-requests`, `productattachments` (чужая модель, `exists`), `qr` (чужая модель), `production-orders`, `salesorders.service`, `shipments`, `facet-elements`, `showcase-materials`, `showcase-similar`, `showcase-sku`, `stock-composition`, `stock-summary`, `work-type`, `module-work-release` (ещё пишет состав), `work-media`, `work-present`, `work.service`, `dicts.product-facets` (список; объединение — в писателях) |
| materials | `catalog-graph` (чужая модель), `supply-scope`, `category`, `fill-audit`, `partners`, `product-module` (чужая модель), `purchase-needs` (чужая модель), `qr` (чужая модель), `order-history`, `salesorders.service`, `showcase-composition`, `stock-zones`, `stock-composition`, `stock-duplicate-preview`, `stock-search` (модель и db.collection), `stock-spec` (чужая модель), `stock-summary`, `supply.service`, `module-work-release`, `zone-events`, `composition-expand` |
| storageitems | `disk/integrity`, `stock-reservations`, `stock-search` (своя модель), `stock-spec`, `stock-summary`, `zone-events` |
| stockmovements | `control.collect`, `partners`, `order-history`, `salesorders.service`, `stock-composition`, `stock-summary`, `supply-invoice`, `supply.service` |
| reservations | `shipment-ready`, `disk/integrity`, `partners`, `salesorders.service`, `stock-hanging`, `stock-summary`, `zone-events` |
| warehouses | `stock-duplicate-preview`, `stock-summary` |
| supplyrequests | `control.collect`, `financial-article-writer`, `fill-audit`, `finance-visibility`, `finance.service`, `salesorders.service`, `showcase-composition`, `stock-movements`, `stock-reservations`, `stock-search`, `stock-summary`, `today`, `zone-events` |

`catalog-references` читает `products` и `materials` по имени из списка (проверка «используется в составе»), не пишет.
