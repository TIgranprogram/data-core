# Карта роли analyst

коммит: не закоммичен (SHIPMENTS-PASSPORTS)

## Паспорта (ПВ, 2026-10-25)
- Справочники паспортов: `backend/src/modules/dicts/dicts.defs.ts:538–724`.
- Сборка текста: `product-passport/passport-v2-text.ts` (шаблон ALL + категория + части), `passport-compose-parts.ts` (описание, назначение, правила, ТО, монтаж), обязательные поля `passport-rules.ts:130–230`.
- Значения изделия по умолчанию: `showcase/passport-defaults.ts` (`PASSPORT_CATEGORY_CODES` зашит в коде).
- Тексты-сид: `backend/scripts/passport-texts.v2.json`, `seed-passport-phrases.js`.
- Нормативы и статусы: `docs/PASSPORTS-V2.md` §2; черновик/выпуск — §10.
- Моё ТЗ воронки: `docs/roles/tz/PASSPORT-FUNNEL-analyst.md`; вопросы П1–П4 в QUESTIONS.
- Ключевой вывод: монтаж живёт в 3 местах (шаблон ALL, passportInstall, passportPhrases) — сливать.
- Сверка нормативов 2026-10-25: `docs/roles/tz/PP-STANDARDS-CHECK.md` (DSP: 57538 неверно → 55677-55679; ГОСТ Р 56440-2015 для универсального спорт-оборудования).

## Справочники (DICT, 2026-10-25)
- ТЗ: `docs/roles/tz/DICT.md`. Сервер: `modules/dicts/dicts.{service,defs}.ts`. Ключевое: переименование строковых справочников без каскада ломает ссылки; `used`/`related` тяжёлые.

## Каталог поставщика (SC, 2026-10-25)
- Аудит: новая коллекция `supplieritems` (не трогать общую с kppdf `materials`).
- Поставщик-организация: `organization.type[]` уже содержит `'supplier'`; нужно добавить `catalogUrl?: string` и `lastCatalogSyncAt?: Date`.
- Уникальный ключ upsert: `{ supplierId, vendorArticle }`.
- Связь с заявками: `supplyrequests` добавить необязательный `supplierItemId?: ObjectId` + snapshot-поля.
- Граница: showcase-модуля нет; продукция — паспорта изделий; смешения нет.
- Вопросы SC-1…SC-3 в `docs/QUESTIONS.md`.

## Проектирование-доска (DESIGN-BOARD, 2026-10-25)
- ТЗ: `docs/roles/tz/DESIGN-BOARD.md`. Сервер `modules/design` (задача = позиция заказа, `designtasks`); новое — `designorders`. PWA: `sections/design.js`, `order-design.js`, `ui/board.js` (drag).

## Три названия (ТИ-8, 2026-10-27)
- ТЗ: `docs/roles/tz/NAMES.md`. ДМ.2 уже добавил `products.fullName/orderName`, `materials.fullName/invoiceName`; новых полей не нужно. Позиция заказа — `incomes.title` (снимок заказчика). Вопросы Н-1, Н-2 в QUESTIONS.
- Дыры: `requests.js` и `invoice.js` сливают всё в одно `title/name`.

## Замечания 27.10 (FB, 2026-10-27)
- ТЗ: `docs/roles/tz/FEEDBACK-1027.md` (пароль, «По заказам»-2, «Связать с каталогом», стикеры/фото). Находки: на сервере нет запрета правки позиций сформированного заказа (`incomes.controller.ts:48–63`, только admin/manager); `designtasks` без фото, миниатюра с позиции; в UNIFIED-DB-MAP `designtasks` не упомянут. Вопросы Ф-1…Ф-6.

## Документация/заказы (ТИ-11, 2026-10-27)
- ТЗ: `docs/roles/tz/DOCS-ORDERS.md`. Есть `status` draft/issued/annulled, `salesOrderId`/`orderNo`; нет `readiness`, нет группировки. Экран: `pwa/sections/docs.js:20`. Вопросы Д-1…Д-3.

## Задачник проектирования (DESIGN-DISCUSSION, 2026-10-27)
- ТЗ: `docs/roles/tz/DESIGN-DISCUSSION.md`. YouGile: сообщения у 87/92 задач (238), чек-листы 3, подзадачи 8. Схема задачи `design/design-task.schema.ts:17–47`; `products.sku` уникален `common/catalog/product.schema.ts:71` → исполнение = отдельное изделие `sku 3404.2` + `baseSku/variant`. `photos` — только картинки → новая `files`. Вопросы ДО-1…ДО-3. коммит: — (не закоммичено)

## Каталог поставщиков v2 (2026-10-28)
- ТЗ `docs/roles/tz/SUPPLIER-CATALOG.md`. Экран `pwa/sections/supplier-catalog.js`, сервер `modules/supply/supplier-excel.service.ts`, схема `supplier-item.schema.ts`; алиасы `supplier_aliases`. Прод-замер не вышел (вход).
- ОТГ/ОП (2026-10-28): ТЗ `docs/roles/tz/SHIPMENTS-PASSPORTS.md`. Этапы `common/text/order-key.ts:8`; паспорт `product-passport.schema.ts:59,69,163` (нет `incomeId`); задача дизайна `design/design-task.schema.ts:20-33`; `issuedByLine` = выдача склада, не отгрузка. Вопросы ОП-1…ОП-5.

## Аудит «Деньги» (2026-10-28)
- `docs/audit/MONEY-AUDIT-2026-10-28.md`. Позиции 78 %, календарь 70 %, ФОТ 25 %. Ключ: выплаты по `invoiceDate`, не `paidAt` (`finance.service.ts:50`); поступления = оплата ?? отгрузка; ФОТ на проде показывает DEMO (`payroll.js:70`). Вопросы В-1…В-5 — в отчёте, в QUESTIONS не перенесены. коммит: —
