# Аудит таблиц базы (БЗ-14, шаг 1: только отчёт)

Дата: 2026-10-24 · Хранитель данных · ТЗ `docs/roles/tz/BZ-14.md`. Ничего не удалялось и не писалось.

## 0. Как читать и что НЕ удалось

- **Живых чисел нет.** Docker на этом ПК не запущен, локальной Mongo нет, на прод (`datacore`) ходить нельзя. Поэтому колонки «записей» и «последняя запись» — **не заполнены**, кроме нескольких чисел из журналов (отмечены датой). Все выводы «мёртвая / живая» — **по коду** (кто пишет и читает), а не по данным.
- Как снять числа, не рискуя: админка → «Таблицы» (счётчик записей уже есть в `GET /api/admin/collections`) или стенд/копия базы. Дату последней записи даёт `max(updatedAt)`; для этого нужен небольшой read-only скрипт `backend/scripts/data-audit-counts.js` (план → по умолчанию только чтение). Напишу его по «да» координатора и прогоню на копии.
- Таблиц в реестре админки **95**; в «98» входят ещё таблицы вне реестра: `dict_values` (все простые справочники data-core, поле `dict`), `passporttemplates` (тексты паспортов) и, по коду, `app_supply_invoices` (старая копия счетов — архив, удалить по «да» пользователя; см. `sheets-sync.mapping.ts`). Это предположение: подтвердить списком из админки.
- Методика колонок «пишет / читает»: `dc` — `backend/src` data-core; `kp` — `D:\kppdf-8.0\backend\src`. Список модулей — результат поиска по имени коллекции и классу схемы (возможны единичные ложные совпадения). «Приложение» — `backend/pwa` («Рабочее место»).
- Объяснение слов: **главная** — таблица, в которую сливаем; **ключ** — по какому полю считаем записи «одним и тем же».

## 1. Пары дублей понятий (критерий 2)

Важная поправка к вопросу: `partners`, `catalog`, `product` — это **модули (адреса API)**, а не таблицы. `partners` — экран «Контрагенты» поверх `organizations`; `catalog`/`product` в kppdf — адреса поверх `products`. Настоящие пары таблиц — ниже.

| № | Понятие | Где лежит сейчас | Главная (предложение) | Ключ сопоставления | Сколько совпадает / расходится |
|--|--|--|--|--|--|
| 1 | **Цвета** | `color_references` (data-core: справочник «Цвета»; kp: тоже) и текст «цвет» в позициях склада (`materials.color`), заказах, паспортах | `color_references` | RAL-код (4 цифры) → иначе название без регистра/ё/пробелов/кавычек | числа — после копии базы. 2026-10-23 добавлено 27 цветов (HISTORY). Сами позиции склада хранят цвет **строкой**, не ссылкой |
| 2 | **Единицы измерения** | `units` (справочник) ↔ строка `unit` в `materials`/`supplyrequests`/`storageitems` ↔ список «Единицы» в настройках `supply.sheetLists` | `units` | сокращение (шт, кг, м, м²) без точки и регистра | строки в заявках и складе не ссылаются на `units` — сверка нужна по данным |
| 3 | **Категории** | `categories` (иерархия, `type: material`) ↔ `dict_values`/`passportCategories` (категории паспортов, ALL/DIO/DSP/TRN/WRK/MAF) ↔ текстовое `category` в заявках, доходах | `categories` — для материалов; **`passportCategories` — отдельное понятие** (вид паспорта), объединять нельзя | название; у паспортов — код | `passportCategories.catalogNames` уже связывает категории паспортов с категориями каталога по названию — это единственная ссылка, она хрупкая (текст) |
| 4 | **Контрагенты / организации** | `organizations` (data-core «Контрагенты»: поставщики, наши компании, заказчики `type:['customer']`; ИНН, банк) ↔ `counterparties` (схема в обоих кодах; ИНН обязателен) ↔ текст «заказчик» (`customer`) в `salesorders`, `incomes`, `supplyrequests.orderLabel` | **`organizations`** | ИНН (10/12 цифр) → иначе название без «ООО/ИП», кавычек, регистра | `counterparties` в «Рабочем месте» **нигде не используется** (модуль есть, экрана нет); kppdf использует её активно (заказы, сверки, шаблоны). Расхождение числом — по данным. Заказчик в заказах — только текст, id вида `c:<название>` |
| 5 | **Сотрудники** | `persons` (data-core: справочник «Сотрудники», ставки, график) ↔ `workers` (kp: исполнители производства, `ratePerHour`, `grade`) ↔ `users` (логины) | `persons` | ФИО (фамилия+имя+отчество без регистра, ё=е) | `workers` — CRM-таблица, data-core её не читает, кроме проверки «занят ли вид работ» (`catalog-references.ts`). `users`↔`persons` связи нет: сотрудник без логина и логин без сотрудника — норма |
| 6 | **Изделия** | `products` (каталог; data-core «Продукция»; kp — основной каталог, 21 модуль ссылается) ↔ `productpassports` (паспорта: поле модели/артикул текстом + `productId`) ↔ строки позиций в `orders`(kp)/`incomes`(dc) | `products` | артикул (`skuKey`: регистр, похожие буквы KC-01=КС-01, пробелы) | 2026-10-22 `products` было **0**, паспортов 330 → 247 моделей (БЗ-8 «Изделия из паспортов»). Позиции заказов связаны с изделием текстом |
| 7 | **Подписи значений** | `dictionary_labels` (`productKind`, `materialKind` — «вид изделия/материала») ↔ `dict_values` (простые справочники data-core) | `dict_values` (одна таблица справочников) | `scope`+`key` ↔ `dict`+код | `dictionary_labels` читает только kppdf-интерфейс (23 файла) и модуль data-core без экрана. `dict_values` в kppdf **не используется вообще**. Объединять можно только после перевода kppdf или копией до отключения |
| 8 | **Заказы** | `salesorders` + `incomes` (data-core: шапки и позиции-«доходы», по таблице Google) ↔ `orders` (kp: заказ + позиции, `counterpartyId`) ↔ `productionorders`/`quotations`/`contracts` (kp) | `salesorders`+`incomes` (рабочая линия) | номер заказа + заказчик | параллельные линии: данные заказов в kppdf не переносились в data-core. Что из `orders` ценно — решает пользователь (вопрос 3) |
| 9 | **Фотографии** | `photos` (файл) ↔ `productphotos`/`productmodulephotos` (связи) ↔ картинки паспортов/справочников (id фото в `dict_values`, `productpassports`) | `photos` — единственное хранилище файлов | id фото / хеш файла | связевые таблицы — не дубли, это ссылки; проверить «висячие» (ссылка есть, фото нет) — после копии |
| 10 | **Склад** | `materials` (номенклатура) ↔ `storageitems` (остаток по складу) ↔ `stockmovements` ↔ `reservations` | уже разведены; общие с kppdf | артикул+название материала | не дубли; риск — одинаковые материалы с разным написанием (RAL/размер) — отдельный аудит значений |
| 11 | **Списки значений в заявках** (форма оплаты, вид счёта, услуги, график выплат, «кто заказал») | `dict_values` ↔ список в `settings` (`supply.sheetLists`) ↔ значения в `incomes.paymentForm`, `supplyrequests.sheetExtra.*` | `dict_values` | значение без регистра/пробелов/ё | `/supply/lookups` берёт из справочников, пока они не пусты; «хвосты» — `candidates` на экране «Справочники» |

Все пары — дубли **понятий**; без цифр из базы нельзя назвать «сколько записей». Точный план «было → станет» по каждой паре (с числом затронутых записей и спорными значениями) будет сделан скриптом `data-*.js` (план, без записи) после снятия чисел.

## 2. Таблицы реестра: кто пишет / читает / вывод (критерий 1)

Колонки «записей» и «последняя» — **нет данных** (см. п.0). Исключения — в строке. «Пишет/читает: dc» — модули data-core; «kp» — модули kppdf; «—» — нет в коде.

### 2.1 Доступ, безопасность, служебные (16)

| Таблица | Пишет / читает | Вывод |
|--|--|--|
| `users` | dc: auth, admin, user, stock, device-enrollment, desktop · kp: то же + order, worker | живая, **общая**; схему не трогать |
| `roles`, `permissions` | dc+kp: auth, admin | живые, общие |
| `featureflags` | dc+kp: feature-flag | живая, общая; после БЗ-7 флаг `passports.v2` не нужен → проверить, остались ли записи |
| `rate_limit_entries` | dc+kp: rate-limit (TTL) | служебная, чистится сама |
| `desktop_pairing_keys` | dc: ключи `kppd_`; kp: desktop | живая, общая |
| `browserdevicegrants`, `deviceinvites` | dc+kp: device-enrollment | живые, общие; если устройства не заводят — малые |
| `settings` | dc: dicts, setting, sheets-sync, supply · kp: setting | живая, общая |
| `counters` | dc: counter, product-passport · kp: counter | живая, общая (номера паспортов — тут) |
| `auditlogs` | dc+kp: audit | живая, самая быстрорастущая; кандидат на архивацию по сроку (решение пользователя) |
| `idempotency_records` | dc+kp: common/admin (kp ещё bom) | служебная; проверить TTL |
| `entitystatuses`, `statusworkflows` | dc+kp: status | **кандидаты в мёртвые для data-core**: «Рабочее место» их не читает; kp использует |
| `sheets_sync_sources` | dc: sheets-sync · kp: — | живая только у data-core |
| `disk_usage_history` | dc: disk · kp: — | живая (раз в день), мелкая |

### 2.2 Организации, справочники, каталог (22)

| Таблица | Пишет / читает | Вывод |
|--|--|--|
| `organizations` | dc: partners, organization, finance, incomes, stock, supply, showcase, паспорта, sheets-sync · kp: organization | главная для «Контрагентов», **общая**, живая |
| `persons` | dc: dicts, partners, person, salesorders, showcase, stock, supply · kp: person, worker, document-template | главная для сотрудников, общая |
| `counterparties` | dc: counterparty (экрана нет) · kp: 8 модулей | **дубль** `organizations` (пара 4). Для data-core мёртвая; kppdf живёт на ней |
| `sites` | dc: site, counterparty · kp: order, import-task и др. | общая; в «Рабочем месте» не используется |
| `categories` | dc: dicts, material, product, stock, supply, showcase · kp: ещё шаблоны | живая, общая |
| `units` | dc: dicts, supply, showcase · kp: unit | живая, общая (пара 2) |
| `currencies` | dc+kp: currency | общая; ни приложение, ни справочник не читают → кандидат в «спящие» |
| `color_references` | dc: dicts («Цвета»), showcase · kp: color-reference | живая, главная для цветов (пара 1) |
| `dictionary_labels` | dc: модуль без экрана · kp: интерфейс | пара 7; в data-core спящая |
| `worktypes` | dc: dicts, product · kp: 9 модулей | живая, общая |
| `attributedefinitions`, `entityattributevalues` | dc+kp: свои модули; приложение не читает | EAV; **кандидаты в мёртвые** для data-core — проверить, есть ли записи |
| `materials` | dc: stock, supply, dicts, partners, showcase, паспорта · kp: material, supply, import-jobs | живая, **общая** |
| `products` | dc: product, showcase, incomes · kp: 21 модуль | общая; в data-core растёт через «Изделия из паспортов» |
| `productmodules` | dc: product-module, showcase · kp: 17 модулей | общая; в data-core почти не используется |
| `productpassports` | dc: product-passport, dicts, showcase · kp: product-passport | живая (≈330 по 2026-10-22), главная по паспортам |
| `passporttemplates` | dc: product-passport | живая, только data-core (не в реестре) |
| `dict_values` | dc: dicts, паспорта · kp: — | живая, главная для простых справочников (не в реестре) |
| `photos` | dc+kp: photos, product, паспорта | живая, общая (пара 9); файлы — `uploads/` |
| `productphotos`, `productmodulephotos` | dc+kp: свои модули | связи; приложение не читает → проверить на «висячие» |
| `organizationcontacts`, `orgroles`, `counterpartyroles` | dc+kp: свои модули; приложение не читает | связи; `counterpartyroles` идёт за `counterparties`; `orgroles` — для data-core, видимо, мёртвая |

### 2.3 Деньги и склад, общие/data-core (9)

| Таблица | Пишет / читает | Вывод |
|--|--|--|
| `incomes` | dc: incomes, finance, salesorders, sheets-sync · kp: — | живая, **только data-core** |
| `salesorders` | dc: salesorders, finance, supply, stock · kp: — | живая, только data-core |
| `supplyrequests` | dc: supply, stock, partners, sheets-sync · kp: order, supply | живая, **общая** (≈163 по 2026-10-19) |
| `warehouses`, `storageitems`, `stockmovements`, `reservations` | dc: stock, supply, partners, salesorders · kp: warehouse, storage-item, stock-movement, reservation, order | живые, **общие**; схемы — копии |

### 2.4 Таблицы CRM kppdf — в data-core кода нет (около 50)

«Читает dc» — только проверка «занят ли справочник» при удалении (`common/catalog/catalog-references.ts`: `orders`, `quotations`, `costcalculations`, `purchaseorders`, `boms`, `workers`); во всех остальных строках data-core таблицу не читает и не пишет. Пишет только kppdf (модуль указан).

| Группа | Таблицы (пишет kp-модуль) | Вывод |
|--|--|--|
| Документооборот (11) | `document_templates`, `document_template_categories`, `doc_types`, `document_table_types`, `table_templates`, `template_blocks`, `text_blocks`, `text_block_categories`, `studio_documents`, `generated_documents`, `form_profiles` | нужны **по смыслу** data-core: шаблоны документов и тексты (КП, договоры, паспорта в PDF) — пока паспорта в data-core собираются своим кодом (`passporttemplates`), эти таблицы там не нужны. `document_table_types` и `template_blocks` — без прямого модуля-записи (проверить, не мусор) |
| Продажи и закупки (15, без `supplyrequests`/`incomes`/`salesorders`) | `quotations`, `contracts`, `orders`, `shipments`, `invoices`, `tenders`, `desknotes`, `rpps`, `purchaseorders`, `purchaserequests`, `supplytasks`, `cart_items`, `cart_sessions`, `financial_reports`, `reconciliation_acts` | по смыслу заменяются «Заказами/Доходами/Заявками» data-core. `orders`, `invoices`, `contracts`, `quotations` — ценные исторические данные (вопрос 3). `cart_*`, `tenders`, `desknotes`, `rpps`, `shipments` — кандидаты в мёртвые (интернет-корзина, тендеры) |
| Производство (11) | `productionorders`, `ordertasks`, `workorders`, `workorderoperations`, `workcenters`, `workers`, `routingsteps`, `techprocesses`, `costcalculations`, `actualcosts`, `orderclosings` | data-core производство не ведёт. Если цех нужен — это отдельное решение; иначе остаются архивом kppdf. `workers` ↔ `persons` (пара 5). `techprocesses` — без прямого модуля записи (класс `TechProcessOperation`) |
| Склад (1) | `boms` | ведомость материалов; нужна только при производстве |
| Прочее (12) | `import_jobs`, `import_mapping_profiles`, `import_tasks`, `import_todos`, `interactions`, `comments`, `certificates`, `compliancerules`, `inventorfiles`, `catalogattachments`, `mutation_journal`, `migration_flags` | служебное kppdf. `migration_flags` — схемы нет ни в одном коде (пишется скриптами) → при отключении kppdf удаляется вместе с ним. `certificates`, `compliancerules` — по смыслу нужны паспортам/ГОСТ (проверить наполнение) |

## 3. Что нужно data-core без kppdf (критерий 3)

Вывод по коду; решает пользователь по данным.

| Что | Откуда | Куда в data-core | Срочность |
|--|--|--|--|
| Контрагенты-заказчики с ИНН/банком | `counterparties` | слить в `organizations` (`type: customer`), сохранив ИНН; заказчики из `salesorders`/`incomes` связать по id вместо текста | высокая — без этого заказы привязаны к тексту |
| Сотрудники/исполнители | `workers` (ставка, разряд) | в `persons` (поля `grade`, ставка уже есть как `salaryRate`) | средняя |
| История заказов, счетов, договоров, КП | `orders`, `invoices`, `contracts`, `quotations`, `shipments`, `reconciliation_acts` | нет модуля. Минимум — разовая выгрузка в `salesorders`/`incomes` или архивная копия коллекций; полный перенос — отдельная большая задача | решение пользователя (вопрос 3) |
| Шаблоны документов и текстовые блоки | `document_templates`, `text_blocks`, `doc_types` | нужны, если КП/договоры будут печататься из data-core; паспортам не нужны | по желанию |
| Подписи видов (`productKind`, `materialKind`) | `dictionary_labels` | в `dict_values` | низкая |
| Сертификаты, правила соответствия | `certificates`, `compliancerules` | к паспортам/ГОСТ (проверить наполнение) | по желанию |
| Системные: `users`, `roles`, `permissions`, `featureflags`, `settings`, `counters`, `auditlogs`, `idempotency_records`, `rate_limit_entries`, `desktop_pairing_keys`, `browserdevicegrants`, `deviceinvites` | общие | остаются; схемы уже в data-core | — |
| Общие каталоги: `materials`, `products`, `productmodules`, `categories`, `units`, `currencies`, `worktypes`, `photos`, `sites`, `organizations`, `persons`, склад (4 + `supplyrequests`) | общие | остаются главными | — |

Остальные таблицы CRM (корзина, тендеры, служебные записки, РПП, производственные наряды, импорт, журнал мутаций) data-core не нужны; при отключении kppdf — архив (дамп), удаление — только по «да» пользователя.

## 4. Предложение по порядку (не исполнялось)

1. Снять числа (read-only скрипт на копии) и дополнить таблицы выше.
2. Малые справочники: цвета → единицы → категории (ключ — RAL/символ/название) — план «было → станет» в этом файле, скрипт `data-colors.js` и т.п. (план, затем `--apply`).
3. Сотрудники (`workers` → `persons`), затем организации (`counterparties` → `organizations` по ИНН), затем изделия.
4. Перед каждым шагом: бэкап, показ плана пользователю, проверка data-core и (пока работает) kppdf. kppdf читает свои таблицы — их строки не ломаем; слияние делаем «добавить в главную + ссылка», а не «удалить из дубля».

## 5. Вопросы пользователю

1. Можно ли прогнать read-only подсчёт (записи, дата последней записи) на копии прод-базы или на тестовой? Без этого «мёртвые» — только догадка по коду.
2. Таблица `counterparties` (ИНН, реквизиты, заказчики kppdf) — главной считаем `organizations`; подтверждаете? kppdf пока продолжит пользоваться своей.
3. История заказов/счетов/договоров/КП из kppdf (`orders`, `invoices`, `contracts`, `quotations`) — нужна ли внутри data-core (экран «Архив»), достаточно ли разовой выгрузки в файл или переносить в «Заказы/Доходы»?
4. Производство (наряды, станки, маршруты, затраты) в data-core будет? Если нет — 11 производственных таблиц остаются архивом kppdf.
5. Корзина, тендеры, служебные записки, РПП — подтвердите, что это мёртвое и архивировать можно.
6. Сотрудники: `workers` (kppdf) и `persons` (data-core) — один список людей с общим ФИО-ключом?
7. `app_supply_invoices` (старая копия счетов) — удалить после бэкапа? (отдельное «да»)
