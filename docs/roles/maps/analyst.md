# Карта роли analyst

коммит: не закоммичен (ЕН 2026-11-03; C011 2026-11-03; УСЛ 2026-11-04; ДЕНЬГИ 2026-11-04; C022 2026-11-04; ВЛ-1 2026-11-05; C028 2026-11-07; C050 2026-11-08, база a996b595)

## Паспорт воронкой (C028, 2026-11-07)
- Данные прода: `tools/logs/c028/` (483 изделия, 342 паспорта). Признаки: `docs/crew/C028-passport-funnel/facets-seed.json`; анализ — в отчёте координатору (файл ANALYSIS.md пишет координатор).
- Категория группы `categories.passportCategory` пуста у 29/29 → угадывание по корню `common/passport/form-values.ts:66–74` («оборудование» → DIO, 13 изделий). Своя категория изделия — `passportDefaults`.
- Решение: Раздел → Группа (категория) → признаки (`dict_values` productFacets/productFacetValues) → `products.facetValueIds`; `passportTypes` (0) убрать. Правила выпуска `passport-rules.ts:216–255`. Вопросы ПФ-1…3.

## Единая номенклатура (ЕН, 2026-11-03)
- Канон склада — `materials` (+ остаток `storageitems`). Изделия — `products` (ДМ-1: покупные остаются в materials). Каталог — `supplieritems` (data-core), факт цены — `materialprices` → `lastPrice*`. Заявка — снимок `supplyrequests` (`title` без `materialId` допустим; `supplierItemId` нет, СК-3).
- Не сливать прайс (`priceHistory`) и закупки. Не писать прайс в `pricePerUnit`/`supplierId` (их видит CRM). Фильтр «M10×100» — из названия, поля СКФ.7 не заведены. Вопросы ЕН-1, ЕН-2.

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

## Цепочка заказа (CHAIN-AUDIT, 2026-10-28)
- ТЗ: `docs/roles/tz/CHAIN-AUDIT.md`. Этапы `common/text/order-key.ts:8`; счёт `supply/supply-invoice.schema.ts:36` (нет списка GET); заявка `salesOrderId` :175, `invoiceId` :194; «+ Договор в этот заказ» `pwa/sections/salesorders.js:302`. КП — нет сущности (ДМ.8). Вопросы ЦП-1…3.

## Сопоставление договор→продукция (2026-10-29)
- ТЗ `docs/roles/tz/CONTRACT-MATCHING.md`. `productByTitle` incomes.service.ts:178; «Открыть заказы» products.js:373 ищет по тексту договора (salesorders.service.ts:80), не по productId. assign: production-orders.service.ts:81. Вопросы КМ-1…5. коммит: — (не закоммичено)

## Зоны ответственности (ЗО, 2026-10-29)
- ТЗ `docs/roles/tz/RESPONSIBILITY-ZONES.md`. persons — `dicts.defs.ts:474`; `persons.userId` читается в `design.service.ts:101–108`, но не заполняется. Уведомления `notification.schema.ts:13` (только userId). Лента `today.service.ts:54–134`. `supplyrequests.responsible` :114 — на проде пусто у 181/181. Меню `pwa/main.js:102,245`. Вопросы ЗО-1…5. коммит: —

## Быстрые задачи (ЗД, 2026-10-29)
- ТЗ docs/roles/tz/QUICK-TASKS.md. Новая tasks; чат/design-note/designtasks не годятся. План: pwa/sections/home.js:176,348, лента today/today-feed.ts. Общее для выбора объекта: ui/target-picker.js (orderLines/picBox); step-funnel.js — фильтр списка, не подходит. Вопросы ЗД-1…6. коммит: —

## Договоры поставщиков (ДП, 2026-10-29)
- ТЗ `docs/roles/tz/SUPPLIER-CONTRACTS.md`. Новая `suppliercontracts` (имя `contracts` — след старого counterparty, не брать); `supplyinvoices.contractId`. DTO `supply/dto-invoice.ts:14`; экраны invoice.js:207, request-step.js:138, invoices-tab.js, partners.js. kppdf-репо недоступно с этой машины. Вопросы ДП-1…4. коммит: —

## Аудит «В работе» + воронка (2026-10-29)
- `docs/audit/AUDIT-PRODUCTION.md`. Есть: `worktypes` (общая; `work-type.schema.ts`), `ProductModule.workTypes[]` (`product-module.schema.ts:66`), `persons.workTypeId` (один). Нет: маршрута у `products`, `persons.workTypeIds[]`, `worktasks`, пункта «Изготовлено» в `order-readiness.ts`. Образец доски — `modules/design`. Вопросы 1–8 в отчёте, в QUESTIONS не перенесены. коммит: —

## Аудит «Отгрузка» (2026-10-30)
- `docs/audit/AUDIT-SHIPMENT.md`. Сервер `shipments.service.ts:96 create`, `:66 list`; расчёт `common/text/shipment-calc.ts:10`; экран `pwa/sections/order-shipments.js:68 form`; готовность `salesorders/order-readiness.ts:19` (нет «Изготовлено»); `worktasks` `modules/work/work-task.schema.ts`. Список изделий паспорта `passports/models.js:77` без фильтра. Вопросы 1–4 в отчёте. коммит: —

## Аудит паспортов: содержание (2026-10-29)
- `docs/audit/AUDIT-PASSPORTS-CONTENT.md`. Части изделия: в сиде 25 (`data-mi-dicts.js:67`), нет базовых (каркас, поручень, закладная…); у WRK нет норматива (56440 не добавлен); нет ИИ в рантайме; `spec-import.js` = брони, не паспорт; разборщик «Труба 89х3» — `data-mi-dicts.js parseMaterials`. Вопросы В-1…В-7 в отчёте, в QUESTIONS не перенесены. коммит: —

## Аудит КП (2026-10-30)
- `docs/audit/AUDIT-KP.md`. Образец kppdf `quotation.schema.ts`, `convert-to-order` :833 (без цен, только из accepted). В data-core заказ = `salesorders`+`incomes` (не CRM `orders`) → своя коллекция `commercialoffers`, PDF на pdfkit (`shipments/shipment-pdf.ts`). Фоны kp-1str/2str: подпись и печать запечены, нужны «поля» безопасной зоны. Вопросы 1–4 в отчёте, в QUESTIONS не перенесены. коммит: —

## Аудит паспортов: части и материалы по картинкам (2026-10-30)
- `docs/audit/AUDIT-PASSPORT-PARTS.md`. 342 паспорта ≈ 24 группы изделий (≈ 20 типов состава). Составные части (~29) лежат в `passportElements`, не в `passportParts` (там 35, из них мусор «наполнение», «фланец», «Фланцы»). Нет: диск-отягощение, весовой стек, дуга, зацеп, ферма, кольцо баскетбольное, лебёдка, стакан; сортамент: 40×80×2 vs 80×40×2, лист 14. Структура «Тип изделия → части» поверх `materialsSpec` (`common/catalog/materials-table.ts`). Вопросы В-1…В-7 в отчёте, в QUESTIONS не перенесены. коммит: —

## Аудит «Разбор / ночные прогоны / дашборд» (2026-10-30)
- `docs/audit/AUDIT-CONTROL-CENTER.md`. Образец «без висячих» — `fill-audit.service.ts:136`; merge-эндпоинты `partners.controller.ts:73`, `dicts.controller.ts:107`; единственная история метрики — `disk_usage_history` (`disk.controller.ts:59`); `clienterrors` TTL 30 дн; планировщика нет (только setInterval); в админке нет правой панели (DESIGN.md:289), `admin.js` 1576 строк, вход только admin (:1572). Вопросы 1–5 в отчёте, в QUESTIONS не перенесены. коммит: —

## Паспорт за несколько шагов (PFA, 2026-11-01)
- Аудит `docs/audit/PASSPORT-FLOW-AUDIT.md`. Входы: `pwa/sections/docs.js:30–110` (шаблон), `passports/models.js:52` (issuePassport → черновик), мастер `passports/passport-wizard.js:14`; правила выпуска `passport-rules.ts:195–219`; выпуск/снимок `passport-issue.ts:28`.
- Копия базы: 480 изделий, 0 готовы к новому выпуску; `categories.passportCategory` 0/56; размеры в изделии 0. Архива «выдано заказчику» нет (`generated_documents` пуст). Вопросы F1–F3 в отчёте. коммит: —

## Тексты паспорта по нормам (ПТ, 2026-11-01)
- `docs/audit/PASSPORT-TEXTS-REVIEW.md`. Правки — `backend/scripts/passport-texts.v2.json` + `passport-templates-polish.js` (новая версия шаблона; стенд: ALL_V2 v3, TRN v3, DIO v2). Ограничение теста `passport-texts.v2.spec.ts`: порядок разделов зашит, своя категория переопределяет только 1-й пункт общих разделов → новые разделы нельзя без правки теста. Статусы норм — gostinfo.ru (2026-11-01). Вопросы ПТ-1, ПТ-2 в QUESTIONS. коммит: — (не закоммичено, база 45b2192)

## Варианты изделия (ВР, 2026-11-01)
- Аудит: `docs/audit/PRODUCT-VARIANTS.md`. Клон `showcase-clone.ts` не ставит `copiedFromProductId`; `series` только data-core; дыра — `salesorders-matching.js:75` создаёт изделие без проверки похожих. Вопросы ВР-1, ВР-2. коммит: — (не закоммичено)

## Отделы и воронка (ОТД, 2026-11-01)
- `docs/audit/DEPARTMENTS-FUNNEL.md`. `worktypes.department` уже есть (`work-type.schema.ts:21`, не используется); `persons.workTypeIds[]` есть (`person-work-types.ts`); дыра: `issue.js:16 peopleByWork` группирует по виду работ, `stock-mobile.js:128` сравнивает с отделом → не совпадает. Чек-листов нет; план: снимок в `worktasks.route[]`. Вопросы О-1…О-5 в QUESTIONS. коммит: — (не закоммичено)

## Аудит бизнес-логики (C011, 2026-11-03)

- Отчёт `docs/crew/C011-biz-logic-audit/REPORT.md`, правки `FIX-TZ.md`, файлы `INVENTORY.md`.
- Канон: заявка-снимок → `supplyinvoices` → `SupplyService.receive` → `materials`/`storageitems` → бронь/выдача → `salesorders`+`incomes` → `designtasks`/`worktasks` → паспорт изделия → `shipments` → деньги из оплат. `paid` заявки — флаг при `status=ordered` (`badges.js:20`).
- Дыры: `invoice.js:218` не создаёт счёт; `stock-ops.js:314` приход мимо заявки; `order-readiness.ts:24` «выдано» = нет брони; `incomes.service.ts:299` само клеит изделие по короткому имени; `work-type.schema.ts:21` строка `department`, экран читает `departmentId` (`dicts.defs.ts:602`, `stock-mobile.js:197`); КП не рождает заказ (`offers.controller.ts:96`).
- Меню: убрать `matching` из группы (`main.js:234`), «Договоры поставщиков», вернуть `partners`. Вкладки договора не плодить (`salesorders.js:305`).
- Устарело и не чинить заново: запрет правки позиций с `ready` уже в `incomes.service.ts:283`; календарь на `paidAt` (`finance.service.ts:86`). Вопросы C011-1…5. коммит: — (не закоммичено)

## Аудит «Деньги» к финдиректору (2026-11-04)
- Канон: PRODUCT §5 + журнал 2026-10-19 (без отдельной таблицы денег). Факт: `finance.service.ts` `ops`/`cashflow`/`needsFill`/`forecast`/`summary`. Экран: `pwa/sections/money.js` (календарь, сводка, прогноз, долги).
- Факт календаря = оплаченные заявки (`paidAt`, иначе дата счёта) + снимок оплаты счёта + платежи `incomes.payments` + выплаты ФОТ. Неоплаченные счета и отгрузка без оплаты — `pending`, в остаток не входят.
- Дыры: шапка заказа считает «оплачено» только при `paidDate` (`salesorders.service.ts:62`), частичные — нет; календарь корректировки оплаченного счёта не читает (`paymentAdjustments`); прибыли по номеру заказа нет (только направление «Заказы»); выгрузки календаря нет; частичной оплаты поставщику нет; банк и налоги не ведутся. Остаток дней — только если задан «Старт учёта».
- Вопросы В-6/В-7/В-8 уже решены как «позже». Живые остатки прода этим аудитом не смотрелись.

## Админ может всё (ЗЯ-1, 2026-11-05)
- Отчёт `docs/crew/ZYA-1-admin-override.md`. Блоки: `supply.service.ts:416,500-523,542`; `supply-invoice.service.ts:61-68,327,495,598,638,687-689`; `salesorders.service.ts:409,447,466-468`; `incomes.service.ts:283,405-407`; `offer-rules.ts:27,39`. Журнала before/after нет (`audit.interceptor.ts:92` пишет только after) — нужен хелпер.

## Услуги заказа и виды работ (УСЛ, 2026-11-04)
- «Виды работ» — шаги цеха. Услуги заказа/КП/счетов — справочник `services` (`dict_values`), уже на проде (Доставка, Монтаж и др.).
- Решение УСЛ-1: позиция `lineType=service` → `serviceId` из `/api/dicts/services`, не `workTypeId`. Пункт пульта `worktypes-services` снят. КП — тем же справочником позже.

## Склад: воронка новой позиции (C022, 2026-11-04)
- Матрица и чек-лист: `docs/crew/C022-stock-order/ANALYST.md`. Правки: `FIX-TZ.md`. Вид — `metal.ts:11–16` (труба / лист / нет).
- Труба: мойка есть, ширины нет. Лист: ширина есть, мойки нет. Метиз: блока металла нет. Чужие ключи не слать, если категорию с металла не снимали.
- Не эта задача: C011-B, СКФ.6/7, скорость списка (волна B). Вопросов пользователю нет. коммит: — (не закоммичено)

## Вложения изделия (ВЛ-1, 2026-11-05)
- Отчёт `docs/crew/VL-1-attachments.md`. Загрузка: `photos.controller.ts:54`, `image-upload.options.ts`; чертежи уже есть (`product-files.js`, purpose=drawing). Узкие места: nginx `client_max_body_size 16m` (`nginx-datacore-db.conf:17`), публичный `/uploads` (`main.ts:124`), offsite-копия `offsite.ts:224` пакует всю uploads. Решение: отдельная `productattachments` (не поле в `products`), виды — `simpleList` в `dicts.defs.ts:141`, скачивание по тикету. Вопросы ВЛ-В1…В5. коммит: — (не закоммичено)

## Склад: плитки и «Выдать материалы» (СКЛ-1, 2026-11-05)
- План `docs/crew/SKL-1-plan.md`. Слипание: `screens.css:1118-1121` (жёсткий `grid-row:1`, рассчитано на 3 плитки), `stock.js:122-141`. Зоны: `stock-zone.schema.ts:12-18`, сид `stockzones-boards.js:17`. Выдача пачкой уже есть: `POST /stock/batch` (`stock-movements.service.ts:147`), бронь — `reserve-list` (`stock-reservations.service.ts:34`). Вопросы В1–В5. коммит: — (не закоммичено)

## Части изделия × виды работ (C041-A, 2026-11-07)
- `docs/crew/C041-work-composition/` AUDIT/PROPOSAL/QUESTIONS-C041. Есть: маршрут `products.workTypes[]` (+lineId), `worktasks.route[].plan`, Гант `ui/gantt.js`, табель `payroll_timesheets`. Нет: сущности «часть», состава в позиции, галочек, часов/денег по шагу. Решение: `products.parts[]` + `orderlineplans` + `workhours`. Вопросы Q1–Q6. коммит: —

## Мои задания / роли рабочего (C050, 2026-11-08)
- ТЗ `docs/crew/C050-my-tasks/TZ.md`. `users.role` — одна строка (`user.schema.ts:44`), своя роль = baseRole+appSections (`roles-hierarchy.ts`, `app-sections.ts`); образец узкого входа `session.onlyStockMobile` (`pwa/core/api.js:57`). `persons.userId` читается (`design.service.ts:113`), не пишется. `mark` — только admin/manager (`order-line-plan.controller.ts:57`). Решение: `users.extraRoles[]`, `/my-tasks*`, статусы deferred/problem в шаге. Вопросы 1–3 в ТЗ.
