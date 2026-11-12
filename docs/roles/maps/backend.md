# Карта роли backend
## Деньги «По статьям» C084 этап 1 (2026-11-11, не закоммичено)
- `finance/by-articles.ts` buildByArticles (`incomeRows`, `:self`, листья у всех подстатей) и `opsOfCell` (+`counterparty`/`doc`); `cashflow.ts` buildSummary `expensesByArticle`

## Паспорт: фирма, файл, замок позиции C062 (2026-11-11, не закоммичено)
- Фирма = `supplierOrgId`. `passport-bind.ts:15` bindDraft, `:30` assertOneLive; `passport-queue.ts:116` ourSupplierId (ровно одна фирма). Замок: `product-passport.service.ts:228` create, `:339` смена incomeId, `:395` restore; `passport-issue.ts:34` и `:45` (в транзакции до номера). Индекса unique нет. Файл: `product-passport.schema.ts:250` printFile; `passport-print-file.ts:22` presentPrint, `:29` readPrintFile, `:51` storePrintPdf; `product-passport.controller.ts:310` POST и `:319` DELETE `/passports/:id/print-file`; `passport-pdf.service.ts:88` pdf отдаёт файл при pack=passport. Список: `passport-queries.ts:128` attachBind. Вкладка изделия: `showcase.service.ts:281` passports (`productCode`, `supplier`, `printSource`). Юниты: `passport-bind.spec.ts`, `passport-print-file.spec.ts`. e2e и openapi не трогались. Отчёт `docs/crew/C062-passport-bind-audit/REPORT-backend.md`. коммит: —

## PDM-загрузка C057 Э1 часть 2 (2026-11-09, не закоммичено)
- C057-Э1 ч.3: «Что купить» — `common/catalog/purchase-needs.ts` (flattenNeeds, computeNeeds), `modules/product/purchase-needs.service.ts:forProduct`, маршрут `product.controller.ts` `:id/purchase-needs`; приложение — `modules/apps/` (`apps.service.ts`, `AppsModule` в `app.module.ts` до `AppDataModule`), закрытие статики `/uploads/apps` — `productattachments/attachment-paths.ts:isAttachmentsUrl`. Коммит: не сделан.
- `modules/pdm-import/`: `pdm-import.service.ts:50` preview, `:95` apply, `:128` write (тело транзакции: захват плана → решения `:184` decide → `:219` assertFresh/409 → составы в памяти → запись по порядку), `:283` saveFile; чистая логика `pdm-plan.ts` (`:19` checkTree, `:94` rawUsage, `:142` linesOf, `:157` checkLines, `:199` diffPart), план `pdm-plan-rows.ts:86` buildPlan (`:71` exactHit), документы `pdm-write.ts:84` updateOf/`:102` fastenerPatch/`:113` parseDecisions, DTO `dto/pdm-tree.dto.ts`, фикстура `pdm-tree.testkit.ts`. `pdm-files.service.ts` missingSha. `main.ts` json 2mb. e2e `test/e2e/pdm-import.e2e-spec.ts` (14, зелёный). openapi не регенерирован; purchase-needs и приложение на скачивание (п. 5, 7 ТЗ) не делались. Отчёт — в ответе агента (файл REPORT-E1-part2.md создать не дали). коммит: —
## PDM-загрузка C057 Э1 часть 1 (2026-11-09, не закоммичено)
- Поля: `modules/material/material.schema.ts` (pdmCode…needsName, индексы в конце файла), `common/catalog/product(-module).schema.ts` (pdm, needsName), DTO + `common/catalog/pdm-meta.dto.ts`. Ключ: `common/catalog/match-key.ts:159` matchKey, `:171` matchKeyPdm, `:188` designationKey. Файлы: `modules/pdm-files/` (`pdm-files.service.ts:32` save, `:64` list; `pdm-paths.ts`). Скрытие part/isProfile: `common/catalog/stock-visible.ts`, `material.service.ts` findAll, `supply/supplier-catalog.service.ts` materialFilter/counts. Отчёт `docs/crew/C057-pdm-import/REPORT-E1-part1.md`. коммит: —
## Техописание + паспорт C055 Э2 (2026-11-09, не закоммичено)
- Режимы `passport|tech|combined`: `print-pack.ts:8` `packOf` (пусто = passport). `GET /passports/:id/pdf?pack=` и `POST /passports/preview` {pack} — `product-passport.controller.ts:288`, `dto/preview.dto.ts:12`. Сборка: `passport-pdf.service.ts:77` `pdf`, `:93` `preview`, `:152` `sheetOf` (состав → строки, до 4 чтений: 2 справочника + фото). Строки — `common/print/tech-sheet-rows.ts:37` `techSheetRows`. Листы A4 после паспорта — `passport-pdf-v2.ts:34` `after`, `common/print/tech-sheet-pdf.ts:36` `appendTechSheet`. `POST /showcase/:id/tech-sheet` без pack — как раньше. e2e и openapi не трогались. Отчёт `docs/crew/C055-tech-passport/REPORT-E2.md`. коммит: —
## Паспорт: признаки и условия C054 B1–B3 (2026-11-09, не закоммичено)
- Коды пунктов/условия: `passport-compose.ts:80` parseWhen, `:157` наследование по коду + order, `:168` excluded/needJoints, `:228` sectionItems; `passport-sections-check.ts` checkSections/cleanSections (saveTemplate `service:614`, saveTexts `:692`); `passport-promote.ts`, `passport-texts-tree.ts` — по коду. Признаки: `common/passport/traits.ts`, `passport-traits.ts:23` collectTraits/`:61` filterByWhen/jointsMissing; сборка — `passport-v2-text.ts` (traits, excluded, needJoints, layout 2). Справочники — `dicts/dicts.passport-traits.ts:13` withTraits (подключено в `dicts.defs.ts` 5 мест). Нумерация — `passport-numbering.ts:43` planNumbers, `passport-pdf-v2-layout.ts` (plan). `joints` — schema/DTO паспорта, `showcase/passport-defaults.ts`, `passport-from-product.ts`. Тесты: `passport-snapshot-golden`, `passport-when`, `passport-traits`, `passport-numbering`, `passport-pdf-v2-layout2`, `dicts.passport-traits`; e2e `test/e2e/passport-traits.e2e-spec.ts` НЕ запускался. Отчёт `docs/crew/C054-passport-funnel/REPORT-backend.md`. openapi не регенерирован. коммит: —
## «Мои задания» C050 Э1 (2026-11-08, не закоммичено)
- `modules/my-tasks/` (`my-tasks.ts` buildTasks/ownStepFilter/clickTime/deferDate, `my-tasks.service.ts:act`, controller `/my-tasks`); `persons.userId` в справочнике — `dicts.defs.ts` persons (поле, toDoc, softDelete), `dicts.person-login.ts` (canLinkLogin, resolveLogin 409), маски `dicts.payroll.ts` hideLogin/hideContacts + `dicts.controller.ts` payrollMask; поля шага status/statusReason/deferUntil/statusAt — `common/work-route-rows.ts` STATUS_KEYS; раздел `my-tasks` — `common/app-sections.ts`; сид ролей worker/master — `common/seed/work-roles.seed.ts`. e2e `test/e2e/my-tasks.e2e-spec.ts` НЕ запускался. Отчёт `docs/crew/C050-my-tasks/REPORT-E1.md`. коммит: —
## План позиции заказа C041 Э1 (2026-11-07)
- `modules/order-line-plan/` (`order-line-plan.service.ts`: ensure/save/check/applyToProduct/resetFromProduct/forLaunch/markLaunched; controller `/orderline-plans`), чистая логика `common/work-route-rows.ts` (normalizeRows, diffRows, rowsFromProduct, productFields), `common/work-step.ts`; запуск — `work/work.service.ts launch` + `work-flow.ts planLaunch(plans)`; маршрут изделия `work-route.service.ts set/get` (parts, compositionLines); справочник `dicts.defs.ts productPartsList`. Отчёт — конец `docs/crew/C041-work-composition/TZ-E1.md`. коммит: feat(work) в ветке worktree-agent-ac7381702324e672d

## Сводка позиции C040 (2026-11-07, не закоммичено)
- `GET /materials/:id/summary` — `stock/stock-summary.controller.ts` (путь materials, модуль stock — без цикла), `stock-summary.service.ts:summary` (13 чтений разом), чистые расчёты `stock-summary.ts` (buildSuppliers/buildPrices/buildMonthly/topCustomers, поверх `foldPurchases`); spec `stock-summary.spec.ts`. Отчёт `docs/crew/C040-catalog-card/REPORT.md`. коммит: —

## Заявки пачкой (C036 Ш3, 2026-11-07, не закоммичено)
- `supply.service.ts` `createBulk` (+`SupplyInput.supplierId`, `toFields`); `supply.controller.ts` `requests/bulk`; `dto.ts` `SupplyBulkDto`; общий разбор закупок `stock/purchase-history.ts` (`foldPurchases`, `topSupplier`) — им же `stock-search.service.ts` `itemOrdered`/`purchaseSuppliers`; spec `supply.bulk.spec.ts`. Отчёт `docs/crew/C036-nomenclature-audit/REPORT-SH3.md`. коммит: —

## Каталог view=all (C036 Ш1–2, 2026-11-07, не закоммичено)
- `supply/supplier-catalog.service.ts` `listAll`/`materialFilter`/`materialRow`, `counts.noSupplier`; spec `supplier-catalog.view.spec.ts`. Отчёт `docs/crew/C036-nomenclature-audit/REPORT-SH1-2.md`. коммит: —


## Паспорт «воронкой» C028 B1 (2026-11-07, не закоммичено)
- Справочники `dicts/dicts.product-facets.ts:39` (productFacetDefs); pure `common/passport/funnel.ts` (buildFunnel, suggestValue, parseWords); A2 `product-passport/passport-funnel.ts:22` (productFunnel, союз с `{sections}` в controller `funnel`); A3 `passport-gaps.ts:34` (productGaps, маршрут `showcase/:id/passport-gaps` в product-passport.controller); A5 `passport-facet-phrases.ts` + `service.texts(category, productId)`; `showcase.service.ts` `facetIds`. Скрипты `c028-facets-seed.js`, `c028-group-categories.js`. Угадывание по корню убрано (`form-values.ts:55`). Отчёт `docs/crew/C028-passport-funnel/backend-report.md`. Элементы из признаков (C028): `showcase/facet-elements.ts:20` + `showcase.service.ts:455`; `product-passport/passport-gaps.ts:16` elementFits; скрипт `scripts/c028-elements.js`; поле `kind` — `dicts.defs.ts` passportElements. коммит: —

## КП-2 шаблоны по фирмам (C026 этап 1, 2026-11-06, не закоммичено)
- `offers/offer-layout.ts:16` zoneOf с зонами бланка; `offer-backgrounds.service.ts` resolve/update/defaultTerms; `offer-pdf.ts` шапка/НДС/строки; `offers.service.ts` render/preview/copy/defaults/companies; `offer-rules.ts` resolveVat/vatAmount/markedUp; `common/offers-only.ts` + `incomes.service.ts:36` ourCompanies. Spec: `offers.templates.spec.ts`. openapi правлен вручную. Отчёт `docs/crew/C026-kp-templates/backend.md`. коммит: —

## СКЛ-1b склад: выдача «свободно», reserve-list, скрипты зон (2026-11-05, не закоммичено)
- `stock-movements.service.ts:184` batch out (свободно + своя бронь, `details`); `stock-reservations.service.ts:34` reserveList (groupName опц., `salesOrderLineId` в строке); `dto.ts` `StockReserveLineDto`. Скрипты `scripts/stockzones-merge-pipes.js`, `stockzones-rename-wood.js`, `lib/backup-fresh.js`. Отчёт `docs/crew/SKL-1b-report.md`. openapi не обновлён. коммит: —

## Вложения изделия (ВЛ-1, BE-1, 2026-11-05, не закоммичено)
- `modules/productattachments/`: формат/сигнатуры `attachment-formats.ts:signatureOk`, пути/Range/имя `attachment-paths.ts` (`isAttachmentsUrl`, `resolveInside`), тикет `download-tickets.ts`, место `attachment-capacity.ts`, multer `attachment-upload.options.ts`, предпроверка `attachment-upload.guard.ts`, `productattachments.service.ts` (`save`, `fileByTicket`, сид видов `onModuleInit`), контроллеры (`file` — @Public по тикету). Справочник `dicts.defs.ts:attachmentTypesList`, `dicts.meta.ts`.
- `main.ts`: 404 на `/uploads/attachments` перед статикой; `server.requestTimeout` 1 ч. Индекс — `scripts/ensure-indexes.js` MODELS. openapi правлен вручную (скриптом из scratchpad), не регенерирован. e2e не писался. Отчёт — `docs/crew/VL-1-BE1-report.md`. коммит: —

## ЗЯ-1a админ обходит блоки (2026-11-05, не закоммичено)
- `common/admin-override.ts` (`isAdminActor`, `overrideReason`, `adminOverride`→AuditService `admin.override`). `supply.service.ts:488` update(actor) — реквизиты строки; `supply-invoice.service.ts:641` `adminEditLine`; `supply.controller.ts:353`; КП: `offer-rules.ts:25` + `offers.service.ts:189,226`. Тесты рядом, отчёт `docs/crew/ZYA-1a-report.md`. openapi не обновлён. коммит: —

## Деньги: просроченные счета в календаре (MONEY-SHOW §B, 2026-11-04, не закоммичено)
- `cashflow.ts:49` `foldOverdueInvoices`: просрочка (срок ≤ сегодня, не старше `invoiceStaleSince`) встаёт на сегодня, если период включает сегодня; прошлый месяц оставляет счета на своей дате.
- `forecast.ts:31` `invoiceStaleSince` (90 дней); `expectedOps:49` тот же отсев. `finance.service.ts:86` добирает неоплаченные раньше периода; `:184` pending/metrics считаются после переноса. Поля ответа те же.
- Тесты: `cashflow.spec` + `forecast.spec` — 18 зелёных. ФОТ в «счета к оплате» не входит. коммит: —

## Доступы ролей (C020 волна B, 2026-11-04, не закоммичено)
- `common/app-sections.ts:95` `sectionOpen`: `stock-mobile` открывает только `stock`, не `requests`.
- `supply.controller.ts:284` GET `requests` и `:408` POST `receive` — `@AppSection('requests','stock','stock-mobile')`. `stock` оставлен: экран «Остатки» зовёт тот же список и приёмку.
- `supply.controller.ts:342` POST `requests` — без метода, действует класс `requests`. Иначе `stock-mobile` создавал заявки через открытый `stock`.
- `pwa/core/api.js:47` `sees`: нет автопоказа `stock-mobile` от галочки `stock`. `onlyStockMobile:56` без изменений.
- Тесты: `app-sections.spec` + `app-section.guard.spec` — 13 зелёных. `node --check` api.js (stdin) — ок. openapi не трогался. коммит: —

## Склады-зоны (WZ, шаги M сервер + L перевод, 2026-11-01, не закоммичено)
- Доступ: `common/stock-scope.ts` (`stockScopeFor`, `inScope`, `scopeMatch`, `narrowToZone`, кэш зон/дерева/ролей), `common/decorators/stock-scoped.decorator.ts` (`@StockScoped()`), `common/supply-scope.ts` (заявки/каталог по `materialId`/`categoryId`).
- Справочник: `modules/stock-zones/` (schema `stockzones`, service `refresh` + CRUD, controller `/stockzones`); `GET /stock/zones` — `stock.controller.ts`. Роль: `role.schema.ts`/`create-role.dto.ts` `warehouseIds`, `role.service.ts` `setRoleStockScope(name, doc)`.
- Перевод: `stock/*` (`stock-core.service.ts` `visibleMaterials/assertMaterials`, search/catalog/movements/reservations/spec/composition принимают `StockScope`), `supply.controller|service`, `supply-invoice.service` (`assertWhole`, `partial`), `supplier-catalog.service`, `supplier-excel.service`, `material.controller|service`, `category.controller|service`.
- Скрипт `scripts/stockzones-init.js` (+ `.test.mjs`); e2e `test/e2e/stock-zones.e2e-spec.ts` (прогнан на стенде-копии, зелёный). Ловушки: heredoc с обратными кавычками в `node -e` — править файлы скриптом через Write; CRLF-файлы — замены с нормализацией. openapi не перегенерирован (нужен Docker+Mongo). коммит: —

## Паспорта на весь заказ (ПНЗ.2, 2026-11-01, не закоммичено)
- `product-passport/passport-order.ts` (`orderPlan`, `orderIssue`), `dto/order-issue.dto.ts`, `product-passport.service.ts` `orderHost`/`issuedOfOrder`, `passport-pdf.service.ts` `orderPdf`/`input`, `passport-pdf-v2.ts` `renderPassportsPdfV2`; маршруты в controller перед `:id`. Тесты `passport-order.spec.ts`. e2e/openapi не трогались.

## Печать (PRINT-BLANKS, 2026-11-01, не закоммичено)
- `common/print/fill-text.ts` (fillBlanks, printSafe), `safe-doc.ts` (guardDoc в 5 рендерерах), `product-passport/passport-blanks.ts` (printableText, blankItems, LABEL_SOURCES), `product-passport.service.ts` check→blankLabels; `passport-pdf.service.ts` printableText. Тесты: `common/print/*.spec.ts`, `passport-blanks.spec.ts`.

## Фото и файлы изделия (PRODUCT-FILES a–c, 2026-11-01, не закоммичено)
- `modules/product-photo/` (`product-photo-purpose.ts` фильтр/проверка, `.dto.ts`, `.service.ts`), `scripts/passport-images-to-product.js` (+ `.test.mjs`), `product-passport/passport-product-images.ts`, `product-passport.service.ts` `effectiveImages`/`freezeImages`/`check` (изделие+template+hint), `passport-rules.ts` `imageRules`/`missingHint`, `passport-issue.ts` (заморозка), папки загрузок `common/uploads/upload-folder.ts` + `photos.service.ts upload(file, folder)`. e2e/openapi не трогались. коммит: —

## Позиции заказа (ORDER-LINES шаги 1–4, 2026-10-31, не закоммичено)
- `modules/product-requests/` (schema `productrequests`, service: `attachIncome`/`recalc`/`confirm`/`reject`, controller, `product-request-rules.ts` + spec), `incomes/line-type.ts` (`checkLine`) + `incomes.service.ts` `checkType`/`markService`/`syncRequest`, `matching-rules.ts` `request`/`isUnassigned`, `salesorders.service.ts` `UNASSIGNED`/`unassignedCount`. `ShowcaseModule` теперь экспортирует ShowcaseService. Тесты не запускались; e2e не писался, openapi не обновлён.

коммит: 627c9bf (+ HARDEN-1, CC-14…16, SW-2…5 2026-10-31, не закоммичено)

## Паспорта «воронкой» (ПВ) — где что
- Дерево/выбор (pure): `backend/src/common/passport/phrase-tree.ts` — `toNode`, `buildForest(nodes, category)`, `resolveChoices`, `missingChoices`, `checkNode` (запись), `checkChoices`, `parseChoices`, `presentForest`. spec рядом.
- Справочник `passportPhrases`: обёртка `modules/dicts/dicts.passport-phrases.ts` (`passportPhrasesDef`: поля, toDoc с проверками, beforeRemove, usage/related/reassign по `textChoices`); подключена в `dicts.defs.ts` (блок «Тексты паспорта»). В `DictDef` добавлены `toDoc(…, id?)` и `beforeRemove?`; `dicts.service.ts` их зовёт.
- Сборка: `product-passport/passport-v2-text.ts` (`buildV2Text` + `funnel`: purpose/installation → поля, прочие разделы → пункт №slot; `purposeText` удалён). `product-passport.service.ts`: `forest()` (кэш `passports.funnel`), `funnel()`, `choiceMissing()`, `refreshDraft()` (в `get`), `snapshot()` пишет `purpose`/`installationMethod`/`installationTypeId`, `update()` пересобирает при смене `textChoices`.
- Схема/DTO: `textChoices` в `product-passport.schema.ts`, `dto/create-product-passport.dto.ts`; `passport-consts.ts` MODEL_FIELDS.
- Изделие: `showcase/passport-defaults.ts` (`textChoices`, `mergePassportDefaults`), `showcase-bulk.ts` (мерж), `showcase.service.ts` (`setPassportDefaults` проверяет `checkChoices`, `clone`), `showcase-clone.ts` (`cloneDoc`), маршрут `POST /showcase/:id/clone`.
- Миграция: `backend/scripts/passport-funnel-migrate.js` (+ `.test.mjs`): план по умолчанию, `--apply --out`.
- Маршрут `GET /passports/funnel` — `product-passport.controller.ts` (до `:id`).
- e2e добавлены: passports.e2e-spec (ПВ воронка), showcase.e2e-spec (клон, textChoices) — не запускались.

## Фото и стикеры проектирования (DESIGN-STICKERS, 2026-10-27, не закоммичено)
- `modules/design/design-extras.service.ts` (`editable` — права user, `addPhoto`, `setStickers`), `design-sticker.service.ts` (`seedSystem`, CRUD), `design-sticker.schema.ts`, `design-sticker.controller.ts`; `design-present.ts` (photoIds/photos/stickers, один loadPhotos); `common/photos.ts`. Тесты — `design.service.spec.ts` «фото и стикеры», e2e `design.e2e-spec.ts` (прогнан, зелёный). Нет связи user↔person (`persons.userId` не задаётся) — user правит только ничьи задачи. openapi.json не обновлён (нет скрипта). коммит: —

## Обсуждение задач (DESIGN-DISCUSSION эт.1, не закоммичено)
- `modules/design/design-note.{schema,service,controller}.ts`, `design-note-rules.ts` (+spec), `dto/design-note.dto.ts`; счётчики — `design-present.ts`; фильтр `needsAnswer` — `design.service.ts` list; экран `pwa/ui/design-notes.js`. e2e добавлен, НЕ запускался. openapi не обновлён. коммит: —

## Доска проектирования (DESIGN-BOARD, 2026-10-25, не закоммичено)
- `modules/design/design-board.service.ts` (`board`:~38, `lines`, `addOrder`, `removeOrder`), `design-board.controller.ts`, `design-order.schema.ts` (`designorders`, unique orderId); `design.service.ts` `markOrder`/`markQuiet` (upsert метки в `insert()`/`fromOrder()`, `insert(f,userId,mark)`), запрет `create` сразу `done` по позиции. Тесты — в `design.service.spec.ts` (fake `Coll` умеет upsert/aggregate); e2e добавлен, НЕ запускался. openapi правлен вручную. Индекс — `ensure-indexes.js` MODELS.

## Ловушки
- Bash-инструмент ломается на длинных heredoc с кавычками — файлы писать Write-ом.
- Файлы в репо с CRLF: многострочные replace через node — сначала `\r\n`→`\n`.
- `dicts.service.remove` не ставит `updatedAt` — «справочник новее снимка» считается по max(updatedAt, deletedAt).
- openapi.json перегенерируется только в Docker (нужен Mongo).
коммит: 61b18c6 (ПРЖ-3 не закоммичена)

- `modules/design/` — «Проектирование» (ПРЖ-3): `design.service.ts` (правила, from-order, замок `openIncomeId`), `design-present.ts` (выдача пакетом ``: заказы, позиции, изделия+фото, persons), `design-task.schema.ts`, `dto/design-task.dto.ts`, spec — в памяти fake `Coll`; e2e `test/e2e/design.e2e-spec.ts` (не запускался).
- `salesorders`: `priority` (схема/DTO/фильтр/сорт по рангу через aggregate), `get` → `lines[].product`; фото везде из `products.photoIds[0]`.
- Приёмы: `CounterService.nextSeq`, `loadPhotos` (showcase-common), `shortProductName` (showcase/order-product-name); Mongo 4.4 — partial-индекс без $ne/$in, поэтому замок-поле + unique sparse.
- Дома нет node_modules в worktree: junction `mklink /J node_modules D:\data-core\backend\node_modules`; python нет — правки через node/sed.
- openapi.json не перегенерирован (нужен Mongo + dist).

## Группы изделий (2026-10-25, не закоммичено)
- `modules/dicts/dicts.product-groups.ts` (`productGroupDefs`: `productGroups` + `productSections`, подключено в `dicts.defs.ts` после `categories`), spec рядом. `dicts.service.ts` `refNames` — «имя» для select-ссылок (`parentId` → `parentName`). pwa `sections/dicts.js:~295` — lockAfterCreate «Заполнится само» только у `code`.

## DICT — справочники: каскад, usage, права (2026-10-25, не закоммичено)
- `modules/dicts/dicts.meta.ts` — `DICT_META` (sections, refBy, untracked, locked: коды из `showcase/passport-defaults.ts` + `COLOR_/ICON_/FRAME_ALL/COVER_` оформления); применяется в конце `dicts.defs.ts` (`BASE` → `DICTS`), тип `DictBase` без паспорта.
- `dicts.service.ts`: `usage()`, `update()` (каскад `reassign` → потом `$set`, `renameKey`, аудит `dict.renamed`), `remove(…, user)`, `merge(…, user)` (admin для занятого; `dicts.moved.ts` `trackMoved` → `movedIds` ≤500). `DictDef.busy` — быстрая проверка (simpleList/units/colors/persons), иначе `usage()` по одной записи.
- Журнал пишет сам сервис (`AuditService`, DictsModule импортирует AuditModule); PATCH остаётся `dict.updated` + при переименовании ещё `dict.renamed`.
- `dicts.rename.spec.ts`; e2e dicts/showcase правлены, НЕ запускались; openapi правлен вручную (путь `/dicts/{key}/{id}/usage`).

## МЦ — связь позиции склада с материалом паспорта (2026-10-27, не закоммичено)
- `common/catalog/passport-link.ts` (`mergePassportSpec`, `presentPassportSpec`, spec рядом; не называть `*-spec.ts` — jest примет за тест); `material.schema.ts` `passportSpec` + sparse-индекс; `material.service.ts` `setPassportSpec`, `findAll` без текстов; маршрут `PATCH /materials/:id/passport-spec`.
- `materials-text.ts` `specFromComposition` (`link`, `hinted`); `showcase-materials.ts`; слияние — `dicts.defs.ts` passportMaterials; скрипт `scripts/material-passport-spec-fill.js` (+ `.test.mjs`).

## ЗНП → заказы и задачи (2026-10-27, не закоммичено)
- `design.service.ts:209` `update` — `incomeId` разрешён только свободной задаче (`link`, замок `ensureNoOpen`, `markQuiet`); spec «свободную задачу можно привязать»; MAP.md строка `design`.
- `backend/scripts/znp-apply.js` — план/`--apply --out`: productionNo, 6 новых заказов + позиции (clientUid `znp:…`), этап/отгрузка по карточкам YouGile, привязка задач, новые задачи, вопросы (`znp:…`). Прогнан только на mock-сервере (local не поднят). коммит: —

## «Сегодня» (СГД-1, 2026-10-28, не закоммичено)
- kind work (TODAY-SRV): `today.service.ts:work`, `ZONE_OF.work` = design (зоны «Производство» нет).
- `modules/today/`: `today-feed.ts` (buildFeed/buildWeek/buildPulse, окна FEED_WINDOW), `today.service.ts:get`, `today.controller.ts`, specs рядом. `FinanceModule` теперь экспортирует FinanceService. openapi не обновлён (нужен Mongo). коммит: —

## Каталог поставщиков v2 (SUPPLIER-CATALOG эт.1, 2026-10-28, не закоммичено)
- `modules/supply/supplier-catalog.service.ts` (list/counts/upsertOne/bulk/patch/plan→preview/apply/template/export), `supplier-catalog-import.ts` (чистый разбор + classifyRow), `dto-catalog.ts`, маршруты `supply.controller.ts` `catalog/*`; spec `supplier-catalog-import.spec.ts` (разбор + права). Скрипт `scripts/catalog-from-stock.js`. openapi не обновлён, e2e не писался. коммит: —

## Отгрузки, очередь паспортов, история заказа (ОТГ/ОП/ИСТ, 2026-10-28, не закоммичено)
- `modules/shipments/` (`shipments.service.ts` create/list/remove/restore/pdf, `shipment-pdf.ts`, `shipment.schema.ts`, `dto.ts`); расчёты — `common/text/shipment-calc.ts`; этап `partly` — `common/text/order-key.ts`; карточка заказа `lines[].shipped/left` — `salesorders.service.ts` `get`.
- Очередь: `product-passport/passport-queue.ts` (`buildQueue`, `loadQueue`, `fromIncome`), маршрут `GET /passports/queue`; `incomeId` — `product-passport.schema.ts`, `passport-consts.ts` OID_FIELDS.
- История: `salesorders/order-history.ts` (`loadOrderHistory`), `GET /salesorders/:id/history`. e2e `test/e2e/shipments.e2e-spec.ts` НЕ запускался; openapi не обновлён (нужен Mongo). коммит: —

## Заказ производства (PRODUCTION-ORDERS, 2026-10-28, не закоммичено)
- `modules/salesorders/production-orders.ts` (pure: groupKey, summarize, toProduce, compareProductionNo), `production-orders.service.ts` (list — группировка в памяти, get, setStage), `production-orders.controller.ts`; `salesorders.service.ts` `filters()` (общий с list), `ensureDetachable` (409), `productionAddedAt` в create/update; `common/text/production-seq.ts` (`numberLines`, `loadSeq`) — seqNo в lines-lookup/lookup/design-present/passport-queue; `shipments.service.ts` `shipmentNumber`. e2e `production-orders.e2e-spec.ts` зелёный. openapi не обновлён. коммит: —

## Уведомления и мини-чат (УВ, 2026-10-28, не закоммичено)
- `modules/notifications/` (`notification-kind.ts` kindOf/kindFilter/unreadCounts, `notifications.service.ts:notify` — вызывать из других модулей), `modules/messages/` (`messages.service.ts`). Колокольчик в pwa был только в localStorage. Чат v2: messages.service.ts (send/feed/threads/allSummary), messages.controller.ts (`all`, `all/read`), message.schema.ts (MessageRead). e2e не писался. коммит: —

## Готовность заказа и уведомления (В4, 2026-10-28, не закоммичено)
- `salesorders/order-readiness.ts` (pure `readinessChecks`, `loadReadinessFacts` — 4 агрегации), `production-orders.service.ts` `readiness`/`evaluate`/`recheck` (order_ready, состояние `orderreadystate`), `setStage` → `warnings`; маршрут `:key/readiness`.
- `notifications.service.ts` `safe`/`toRoles`; хуки: `supply-invoice.service.ts update` (счёт выставлен), `supply.service.ts afterStatus`+`supply-notices.ts` (заявка вернулась), `design.service.ts notifyAssigned` (нужен `persons.userId`, связи нет — пока не шлётся). openapi не обновлён. коммит: —

## Сопоставление позиций (CONTRACT-MATCHING КМ1–КМ4, КМ6, 2026-10-29, не закоммичено)
- `modules/matching/` (`matching-rules.ts` suggest/lineState/blockText, `match-facts.ts` loadOrderMatches, `matching.service.ts` suggest/confirm/none/bulk, `product-alias.schema.ts`); блок в `production-orders.service.ts:assign` (400 + `unmatched`, фильтр пропускает `unmatched` — `http-exception.filter.ts`); `salesorders.service.ts` `byProduct` (?productId=); КМ6 — `incomes.service.ts` create/update ставят `matchStatus:auto`. Тесты: `matching.spec.ts`, `production-orders.assign.spec.ts`. e2e не писался, openapi не обновлён. КМ7 (скрипт данных) не делался. коммит: —

## Категория паспорта (PASSPORT-CATEGORY, 2026-10-29, не закоммичено)
- `common/passport/form-values.ts` `passportCategoryFor(item, cats, direct)` + `resolvePassportCategory` (own/inherited); `common/passport/passport-inherit.ts`; `showcase.service.ts` `present` (`ppOwn/ppInherited/ppSource`) и `get` (`passportCategory`); `category.schema.ts`/DTO `passportCategory`; поле в `dicts.product-groups.ts` (`PP_FIELD`); `showcase-from-passports.ts`. Скрипт `scripts/passport-category-report.js` (только чтение). Тесты — `form-values.spec.ts`. e2e и openapi не трогались. коммит: —
- ИЗ (2026-10-31): `product-passport/passport-from-product.ts` (`productPatch`, `diffPatch`, `followsProduct`, `productCategories`) + `product-passport.service.ts` (`syncFromProduct`, `fromProductDiff`, `get`, `list`) + `passport-pdf.service.ts` (`pdf`/`stand`); справочник `productSeries` — `dicts.defs.ts` `productSeriesList`, `dicts.meta.ts`, `form-values.ts` `seriesOptions/seriesInDict`, `showcase.service.ts` `fields` (400 «Выберите серию из справочника»), `scripts/series-dict-fill.js`; spec `series-dict.spec.ts`, `passport-from-product.spec.ts`. коммит: —

## Зоны ответственности (ЗО-1…5, 2026-10-29, не закоммичено)
- `modules/zones/` (`zones.service.ts`: seed, listZones, staff, setZones, linkUser, route/notifyZone, remindUnassigned (час), scopeOf, recordHandoff; `zone-routing.ts` pure; spec). `persons.userId` (partial unique, `person.schema.ts`) / `zoneCodes`; `responsibleId` — `supply-request.schema.ts`, `sales-order.schema.ts`; хуки — `supply.service.ts` afterCreate/afterResponsible, `salesorders.service.ts` afterCreate/update, `design.service.ts` notifyAssigned/notifyUnassigned; «Сегодня» — `today/today-scope.ts`. e2e/openapi не трогались. коммит: —

## Договоры поставщиков (ДП, 2026-10-29, не закоммичено)
- `modules/supply/supplier-contract.{schema,service,controller}.ts` + `dto-contract.ts`; счёт: `supply-invoice.service.ts` `checkContract`/`contractInfo` (update, list, get), `contractId` в схеме и `dto-invoice.ts`. Тесты — `supplier-contract.service.spec.ts`, e2e `supplier-contracts.e2e-spec.ts` (зелёный). openapi перегенерирован через docker. Коллекция читается из счёта «сырой» (`db.collection`), поэтому `deletedAt: null` вручную. Роли `supply` нет — только admin/director/manager/user. коммит: —

## «В работе» (AUDIT-PRODUCTION шаги 0–2, 2026-10-29, не закоммичено)
- `modules/work/`: `work.service.ts` (`list` — доска+колонки, `launch`, `move`/`finish`/`cancel`/`patch`/`people`), `work-flow.ts` (pure: `positionAt`, `mergeColumns`, `planLaunch`), `work-route.service.ts` (маршрут `products.workTypes[]`, подсказка из модулей), `work-present.ts`, `work-task.schema.ts` (`worktasks`, замок `openIncomeId`); контроллеры `work-tasks`, `work-routes`; раздел `work` в `common/app-sections.ts`.
- Шаг 0: `persons.workTypeIds[]` — `common/catalog/person-work-types.ts`, `dicts.defs.ts` persons (`toDoc` не стирает чужие виды работ при старом одиночном поле). Защита удаления вида работ — `work-type.service.ts` + `catalog-delete-guards.spec.ts`.
- e2e `test/e2e/work.e2e-spec.ts` НЕ запускался; openapi не обновлён. Уведомления зоне при запуске нет (зоны «Производство» ещё нет — шаг 4). коммит: —

## КП-1 (коммерческие предложения, 2026-10-30, не закоммичено)
- `modules/offers/`: `offers.service.ts` (list+counts, CRUD, `setStatus`, `pdf`), `offer-rules.ts` (pure: переходы, суммы), `offer-layout.ts` (pure: зоны и `paginateRows`), `offer-pdf.ts` (pdfkit), `offer-backgrounds.service.ts` (фоны, sharp→JPEG, кэш), `offer.schema.ts` (`commercialoffers`, `offerbackgrounds` с `softDelete:false`), `dto.ts`; встроенные фоны `backend/assets/offers/` (+ COPY в Dockerfile). Разделы: `app-sections.ts` `offers`. Тесты: 3 spec рядом, e2e `offers.e2e-spec.ts` (зелёный). openapi не обновлён. коммит: —

## HARDEN-1 (2026-10-30, не закоммичено)
- Деньги: `incomes.service.ts` `derive` (paidDate при платежах), `addPayment`/`removePayment`/`paymentsGuard`, `update(…, opts{guard,push})`; `paymentUids` в `income.schema.ts`. Удаление: `incomes.remove`, `salesorders.service.ts:remove`, `showcase.service.ts:remove`, `partners.service.ts:merge`.
- Склад: `stock-movements.service.ts` `move(…, first)` (clientUid в транзакции, claim отмены), `batch`, `offcut`, `correctMovement`; `stock-reservations.service.ts` (перечитывание брони в tx, clientUid). Снабжение: `supply.service.ts` `receiveRaw`/`update`/`create` (CounterService), `supply-invoice.service.ts:pay`. `shipments.service.ts:create` (tx + clientUid), `payroll.service.ts:addPayment`, `disk.controller.ts` `heavyParts`.
- Уникальный индекс clientUid на движениях/бронях НЕ создавался (решение: в проде возможны дубли из импорта таблиц — сначала отчёт по дублям).
- Ловушка: heredoc с обратными кавычками в `bash -c "…"` выполняет их — длинные скрипты писать Write-ом.

## «Разбор» (CC-14…16, 2026-10-31, не закоммичено)
- `modules/control/questions/`: реестр `question.registry.ts:9` (тип без recheck — ошибка), типы `question.kinds.ts:buildRegistry`, действия `question.actions.ts:buildActions` (partners.merge/dicts.merge/partners.restore/dicts.restore), сбор `question.sources.ts`, дедуп `question.store.ts:upsert`, цикл `questions.service.ts` (`create` лимиты, `answer`/`execute` хеш плана + захват `executing`, `undo` отпечаток `afterHash`), сутки/минута `question.daily.ts`. Вызов — `control.service.ts:tick`. Показатели — `control.collect.ts` (control.*).
- Право `control:write` (не `control:questions`: схема `permissions.action` — enum read|write|admin); POST — `@Roles('user') @Permissions('control:write')`. Фильтр ошибок пропускает `preview` (`http-exception.filter.ts`). Dict merge — необратим (нет списка затронутых id до вызова).
- Ловушки: `mongodb` не импортируется напрямую — только `Types.ObjectId` из mongoose; fake-db в spec копирует ObjectId сам (structuredClone ломает). e2e на стенде: `dc stand up`, root-пароль в tools/.night/stand.env (скрипт в scratchpad), stock-scope.e2e под полной нагрузкой иногда краснеет (по одному зелёный).

## «Переключить сейчас» (HA-TWO-SERVERS SW-2…SW-5, 2026-10-31, не закоммичено)
- `modules/control/switch/`: правила `switch.rules.ts`, сервис `switch.service.ts:refresh` (кэш 2 с, брошенная работа), `:acquire` (захват одним updateOne), `:report` (секрет из файла + нет X-Forwarded-For), middleware `switch.middleware.ts` (подключён `app.module.ts` configure; без HA_SELF — 404 на /control/switch), контроллер/DTO рядом. Тесты: 2 spec + e2e `control-switch.e2e-spec.ts` (зелёный на стенде). `fake-db.testkit.ts` научился upsert/$setOnInsert.
- Хост: `deploy/ha/switch/switch-watch.sh` (мост, проверен на заглушках в scratchpad: успех, расхождение, rsync, VPS-отказ с откатом соседа, аварийный, восстановление), `dc-switch.sh` (проверен), `SRV-ERP/setup-switch.sh` (НЕ запускался; nginx-блок проверен на заглушках), `SRV-ERP/refresh-copy.sh` (проверка role=main, роль standby после восстановления, маркер last-refresh).
- Обновление запасного (C013): `switch.rules.ts:canRefreshNow` (100), `switch.service.ts:refreshPeer` (284) и `canRefresh` в `status` (226) — главный + normal + нет работы + мост, blockers не входят. `POST /control/switch/refresh` — `switch.controller.ts:43`, admin, `StartSwitchDto`. Мост `deploy/ha/switch/switch-watch.sh:do_refresh` (341): без VPS; после restore сосед standby+normal и `job:null`; код — rsync `backend`/`deploy`/`docker-compose.prod.yml`, затем compose build+up; finish снимает readonly, домен не трогает. e2e дополнен, не гонялся. openapi не обновлён.
- Порт 4222 на VPS уже занят туннелем `datacore-ssh-tunnel` (ssh VM) — Sportin→VM идёт через него. Compose: `HA_SELF`, том `${DATA_DIR}/switch`.
- Ловушки: `grep -q` в конвейере под pipefail даёт ложную неудачу (SIGPIPE) — брать `[[ "$(…)" == *x* ]]`; `String.replace` со строкой, где есть `$'`/`$&`, портит текст — только функция-замена; heredoc с `EOF` внутри JS в bash ломается — JS писать Write-ом.
- коммит: —

## QR-коды (QR-CODES п.1–5, 2026-11-01, не закоммичено)
- `modules/qr/`: `qr-code.ts` (makeCode/CODE_RE/qrUrl), `qr.service.ts:ensureCode`/`resolve`/`print`, `qr-pdf.ts:renderQrSheet`, `qr.controller.ts` (+`QrRedirectController` `/q/:code`, исключён из префикса в `main.ts`), `qr.schema.ts`; `scripts/qr-backfill.js` (+test), `ensure-indexes.js` MODELS. Кнопки пульта — общие «Скрипт» (prodScripts). Хука «при создании позиции» нет — код выдаётся при печати/backfill. коммит: —

## C086 — материалы описания PDF (2026-11-12)
- `backend/src/modules/product-passport/passport-from-product.ts:38`: materialsText → materials; `passport-compose-parts.ts:84`: таблица → справочник → текст; `passport-v2-text.ts:126`: полный справочник для строк состава. Тест повторной сборки `passport-from-product.spec.ts:25`. 50 suites / 559 tests, tsc/eslint PASS. коммит: — (не выполнен).

## C090 — частичные оплаты (2026-11-12)
- `backend/src/modules/salesorders/salesorders.service.ts:63`, `production-orders.service.ts:162`: paidDate → amount, иначе paidAmount ?? 0; фильтры deletedAt/cancelledAt сохранены. Регрессия: `backend/test/e2e/salesorders.e2e-spec.ts:145` (8 случаев × 2 сводки). Отчёт: `docs/crew/C090-small-fixes/BACKEND.md`. коммит: — (не выполнялся).
