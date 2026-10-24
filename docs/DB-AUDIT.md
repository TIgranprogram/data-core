# Аудит таблиц базы (БЗ-14, шаг 1: только отчёт; числа с прода 2026-10-24)

Дата: 2026-10-24 · Хранитель данных · ТЗ `docs/roles/tz/BZ-14.md`. Ничего не удалялось и не писалось.

## 0. Как читать

- **Числа сняты 2026-10-24** с прода (`datacore`) только на чтение скриптом `backend/scripts/data-audit-counts.js` (координатор). Колонки: «записей», «в корзине» (`deletedAt`), «последняя» (`max(updatedAt)`). Выводы «мёртвая / спящая / живая» — по числам **и** по коду.
- Правило: **мёртвая (кандидат)** — пусто или последняя запись старше 30 дней (до 2026-09-24) **и** в `backend/src` data-core её никто не пишет. **Спящая** — пусто, но модуль data-core есть. **Живая** — есть свежие записи.
- Снимок: 98 таблиц, из них **46 с данными и 52 пустых**. `app_supply_invoices` в снимке **нет** (ссылка есть только в `sheets-sync.mapping.ts`) — удалять нечего. Новая в отчёте: `supplier_aliases` (5, 2026-10-21, пишет data-core).
- «Пишет / читает»: `dc` — `backend/src` data-core; `kp` — `D:\kppdf-8.0\backend\src`; «Приложение» — `backend/pwa`.
- **Главная** — таблица, в которую сливаем; **ключ** — по какому полю записи считаются «одним и тем же».
- **Главная находка:** в этой базе у kppdf нет данных — `orders`, `invoices`, `contracts`, `quotations`, `counterparties`, `workers`, все производственные — по **0**. См. «⚠ Противоречие» в п.5.

## 1. Пары дублей понятий (критерий 2)

`partners`, `catalog`, `product` — **модули (адреса API)**, а не таблицы. `partners` — экран «Контрагенты» поверх `organizations`. Настоящие пары таблиц — ниже; «сверка значений» = сопоставление по значениям, делается на шаге плана объединения (скрипт `data-*.js`, план без записи).

| № | Понятие | Где лежит · записей | Главная | Ключ | Совпадение / расхождение |
|--|--|--|--|--|--|
| 1 | **Цвета** | `color_references` **28** (2026-10-23; 27 добавлены 10-23) · текст цвета в `materials` (261), `storageitems` (259), `supplyrequests` (188), паспортах (337) | `color_references` | RAL-код (4 цифры) → иначе название без регистра/ё/пробелов/кавычек | в позициях цвет — **строка**, не ссылка; сверка значений — на шаге плана объединения |
| 2 | **Единицы** | `units` **11** · строка `unit` в `materials` 261 / `supplyrequests` 188 / `storageitems` 259 · список «Единицы» в `settings` (6) | `units` | сокращение (шт, кг, м, м²) без точки и регистра | справочник мал (11) — разных написаний в 700 строках больше; сверка значений — на шаге плана |
| 3 | **Категории** | `categories` **21** (+2 в корзине, 2026-10-23) ↔ категории паспортов в `dict_values` (206 всего на все справочники) ↔ текстовое `category` в заявках/доходах | `categories` для материалов; **`passportCategories` — отдельное понятие**, не сливать | название; у паспортов — код | связь паспортов с каталогом — только по названию (`catalogNames`), хрупкая; сверка значений — на шаге плана |
| 4 | **Контрагенты / организации** | `organizations` **25** (2026-10-22) ↔ `counterparties` **0** ↔ текст «заказчик» в `salesorders` (37), `incomes` (143), `supplyrequests.orderLabel` (188) | **`organizations`** | ИНН (10/12 цифр) → иначе название без «ООО/ИП», кавычек, регистра | `counterparties` пуста: сливать **нечего** (совпадение 0 из 0). Работа — внутри `organizations` (дубли по ИНН/названию, 25) и привязка текстовых заказчиков к id; сверка значений — на шаге плана |
| 5 | **Сотрудники** | `persons` **5** (2026-10-21) ↔ `workers` **0** ↔ `users` **7** | `persons` | ФИО (фамилия+имя+отчество, ё=е, регистр) | `workers` пуста: сливать нечего. `users`↔`persons` связи нет (7 логинов на 5 сотрудников) — норма, сверка по ФИО на шаге плана |
| 6 | **Изделия** | `products` **252** (+5 в корзине) ↔ `productpassports` **337** (+3) ↔ `orders` (kp) **0**; позиции `incomes` 143 — текстом | `products` | артикул (`skuKey`: регистр, похожие буквы KC-01=КС-01, пробелы) | паспортов на 85 больше, чем изделий: ожидаемо (несколько паспортов на модель; 247 моделей по БЗ-8 против 252 изделий — 5 лишних, возможно вручную добавленные); сверка артикулов — на шаге плана |
| 7 | **Подписи значений** | `dictionary_labels` **8** (2026-09-12, не менялась) ↔ `dict_values` **206** (2026-10-23) | `dict_values` | `scope`+`key` ↔ `dict`+код | 8 подписей = крошечный перенос; нужен только после перевода kppdf-интерфейса; сверка — на шаге плана |
| 8 | **Заказы** | `salesorders` **37** + `incomes` **143** ↔ `orders` **0** ↔ `quotations`/`contracts`/`productionorders` **0** | `salesorders`+`incomes` | номер заказа + заказчик | параллельной линии в данных **нет**: kppdf-заказов 0. Дублей нет |
| 9 | **Фото** | `photos` **1093** ↔ `productphotos` **0**, `productmodulephotos` **0** ↔ id фото внутри `dict_values`, `productpassports` | `photos` | id фото / хеш файла | связевые таблицы пусты — ссылки хранятся в самих записях; «висячие» ссылки и файлы-дубли по хешу — сверка на шаге плана |
| 10 | **Склад** | `materials` **261** (+2 в корзине) ↔ `storageitems` **259** ↔ `stockmovements` **150** ↔ `reservations` **3**, `warehouses` **2** (+1) | уже разведены; общие | артикул + название | не дубли. Разница 261/259 = 2 материала без остатка — проверить (совпадает с 2 в корзине?) |
| 11 | **Списки значений в заявках** | `dict_values` ↔ `settings` (`supply.sheetLists`) ↔ значения в `incomes.paymentForm` (143), `supplyrequests.sheetExtra.*` (188) | `dict_values` | значение без регистра/пробелов/ё | сверка значений — на шаге плана («хвосты» видны как `candidates` на экране «Справочники») |

**Оценка по числам:** реальный объём слияния мал — 5 справочных пар на сотни строк (цвета, единицы, категории, организации внутри, значения в заявках). Пары 4, 5, 8 — слияние «из пустой таблицы» (0 записей), ничего переносить.

## 2. Таблицы реестра: кто пишет / читает / вывод / числа (критерий 1)

В колонке «Числа»: **записей** (корзина) · последняя запись. «—» = нет записей.

### 2.1 Доступ, безопасность, служебные

| Таблица | Числа | Пишет / читает | Вывод |
|--|--|--|--|
| `users` | 7 · 2026-10-22 | dc: auth, admin, user, stock, device-enrollment, desktop · kp: то же + order, worker | живая, **общая**; схему не трогать |
| `roles` | 5 · 2026-10-20 | dc+kp: auth, admin | живая, общая |
| `permissions` | 33 · 2026-10-23 | dc+kp: auth, admin | живая, общая |
| `featureflags` | 5 · 2026-10-22 | dc+kp: feature-flag | живая; после БЗ-7 `passports.v2` не нужен — проверить, осталась ли запись (из 5) |
| `rate_limit_entries` | — | dc+kp: rate-limit (TTL) | служебная, чистится сама (0 — норма) |
| `desktop_pairing_keys` | 1 · 2026-10-02 | dc: ключи `kppd_`; kp: desktop | живая (1 ключ), общая |
| `browserdevicegrants` | 8 · 2026-10-22 | dc+kp: device-enrollment | живая, общая |
| `deviceinvites` | 11 · 2026-10-20 | dc+kp: device-enrollment | живая, общая |
| `settings` | 6 · 2026-10-24 | dc: dicts, setting, sheets-sync, supply · kp: setting | живая, общая |
| `counters` | 8 · 2026-10-22 | dc: counter, product-passport · kp: counter | живая, общая (номера паспортов) |
| `auditlogs` | 329 · 2026-10-21 | dc+kp: audit | живая; всего 329 — архивация по сроку **пока не нужна** |
| `idempotency_records` | 19 · 2026-10-21 | dc+kp: common/admin | служебная; 19 — TTL работает |
| `entitystatuses` | 15 · 2026-09-12 | dc+kp: status | сид, не менялась 42 дня; приложение не читает → **спящая** для data-core |
| `statusworkflows` | 3 · 2026-09-12 | dc+kp: status | то же: сид, **спящая** |
| `sheets_sync_sources` | 2 · 2026-10-18 | dc: sheets-sync | живая, только data-core |
| `disk_usage_history` | 3 · нет даты | dc: disk | мелкая; 3 записи (не раз в день?) — проверить расписание, записей без `updatedAt` |
| `supplier_aliases` | 5 · 2026-10-21 | dc: supply | живая, только data-core |
| `mutation_journal` | 2 · 2026-10-02 | kp-служебная | почти пуста, 22 дня без записи — кандидат в мёртвые |
| `migration_flags` | 1 · 2026-09-12 | скрипты (схемы нет) | 42 дня без записи, схемы нет → кандидат в мёртвые (флаг уже выполненной миграции — удалять только с kppdf) |

### 2.2 Организации, справочники, каталог

| Таблица | Числа | Пишет / читает | Вывод |
|--|--|--|--|
| `organizations` | 25 · 2026-10-22 | dc: partners, organization, finance, incomes, stock, supply, showcase, паспорта, sheets-sync · kp: organization | **главная** «Контрагентов», общая, живая |
| `persons` | 5 · 2026-10-21 | dc: dicts, partners, person, salesorders, showcase, stock, supply · kp: person, worker | главная для людей, общая, живая |
| `counterparties` | **0** | dc: counterparty (экрана нет) · kp: 8 модулей | пара 4: пуста; для data-core мёртвая, для kppdf — его таблица (пока пустая) |
| `counterpartyroles` | 4 · 2026-09-12 | dc+kp | сид, 42 дня; идёт за пустой `counterparties` → кандидат в мёртвые |
| `orgroles` | 4 · 2026-09-12 | dc+kp | сид, приложение не читает → **спящая/кандидат** |
| `organizationcontacts` | — | dc+kp | пустая, модуль есть → **спящая** (контактов нет) |
| `sites` | — | dc: site, counterparty · kp | пустая, **спящая** (не используется) |
| `categories` | 21 (2) · 2026-10-23 | dc: dicts, material, product, stock, supply, showcase | живая, общая |
| `units` | 11 · 2026-10-22 | dc: dicts, supply, showcase · kp: unit | живая, общая (пара 2) |
| `currencies` | 1 · 2026-09-12 | dc+kp: currency | одна запись (рубль), не менялась → **спящая**, но нужна как справочник |
| `color_references` | 28 · 2026-10-23 | dc: dicts, showcase · kp: color-reference | живая, главная цветов |
| `dictionary_labels` | 8 · 2026-09-12 | dc: модуль без экрана · kp: интерфейс | 42 дня без записи; **спящая** (пара 7) |
| `worktypes` | 9 · 2026-10-22 | dc: dicts, product · kp | живая, общая |
| `attributedefinitions`, `entityattributevalues` | — / — | dc+kp (EAV) | **пустые обе**; приложение не читает → кандидаты в мёртвые для data-core (EAV не запущен) |
| `materials` | 261 (2) · 2026-10-22 | dc: stock, supply, dicts, partners, showcase, паспорта · kp | живая, **общая** |
| `products` | 252 (5) · 2026-10-23 | dc: product, showcase, incomes · kp: 21 модуль | живая, общая |
| `productmodules` | — | dc: product-module, showcase · kp | пустая → **спящая** (модулей изделий нет) |
| `productpassports` | 337 (3) · 2026-10-23 | dc: product-passport, dicts, showcase | живая, главная по паспортам |
| `passporttemplates` | 10 · 2026-10-23 | dc: product-passport | живая, только data-core |
| `dict_values` | 206 · 2026-10-23 | dc: dicts, паспорта · kp: — | живая, главная для простых справочников |
| `photos` | 1093 · 2026-10-23 | dc+kp | живая, самая большая по числу, общая |
| `productphotos`, `productmodulephotos` | — / — | dc+kp | пустые — ссылки хранятся в записях → кандидаты в мёртвые (схемы нужны kppdf) |

### 2.3 Деньги и склад, общие/data-core

| Таблица | Числа | Пишет / читает | Вывод |
|--|--|--|--|
| `incomes` | 143 · 2026-10-20 | dc: incomes, finance, salesorders, sheets-sync | живая, только data-core |
| `salesorders` | 37 · 2026-10-21 | dc: salesorders, finance, supply, stock | живая, только data-core |
| `supplyrequests` | 188 (11) · 2026-10-23 | dc: supply, stock, partners, sheets-sync · kp | живая, **общая**; в корзине 11 — больше всех |
| `warehouses` | 2 (1) · 2026-10-18 | dc+kp | живая, общая |
| `storageitems` | 259 · 2026-10-22 | dc+kp | живая, общая |
| `stockmovements` | 150 · 2026-10-21 | dc+kp | живая, общая |
| `reservations` | 3 · 2026-10-21 | dc+kp | живая, мало |

### 2.4 Таблицы CRM kppdf — в data-core кода нет

«Читает dc» — только проверка «занят ли справочник» при удалении (`common/catalog/catalog-references.ts`: `orders`, `quotations`, `costcalculations`, `purchaseorders`, `boms`, `workers`). Из 50 таблиц **43 пустых**; данные есть у 7:

| Таблица | Числа | Вывод |
|--|--|--|
| `document_templates` | 21 · 2026-10-19 | единственная содержательная CRM-таблица; писателя в dc нет — выяснить, кто писал 10-19 (импорт/сид?). Нужна, если КП/договоры печатаются из data-core |
| `doc_types` | 6 · 2026-10-19 | то же |
| `document_template_categories` | 1 · 2026-09-12 | сид |
| `table_templates` | 1 · 2026-09-12 | сид |
| `text_block_categories` | 1 · 2026-09-12 | сид |
| `mutation_journal`, `migration_flags` | 2 · 1 | см. 2.1 |

Пустые (**0**), по группам:

| Группа | Таблицы | Вывод |
|--|--|--|
| Документооборот | `document_table_types`, `template_blocks`, `text_blocks`, `studio_documents`, `generated_documents`, `form_profiles` | пустые; генераторов документов в data-core нет; `document_table_types`, `template_blocks` без прямого записывающего модуля → кандидаты в мёртвые |
| Продажи и закупки | `quotations`, `contracts`, `orders`, `shipments`, `invoices`, `tenders`, `desknotes`, `rpps`, `purchaseorders`, `purchaserequests`, `supplytasks`, `cart_items`, `cart_sessions`, `financial_reports`, `reconciliation_acts` | **0 везде** — истории заказов/счетов/договоров/КП в этой базе нет. `cart_*`, `tenders`, `desknotes`, `rpps`, `shipments` — кандидаты в архив |
| Производство | `productionorders`, `ordertasks`, `workorders`, `workorderoperations`, `workcenters`, `workers`, `routingsteps`, `techprocesses`, `costcalculations`, `actualcosts`, `orderclosings` | **0 везде** — производство не заведено; архив kppdf |
| Склад | `boms` | 0 |
| Прочее | `import_jobs`, `import_mapping_profiles`, `import_tasks`, `import_todos`, `interactions`, `comments`, `certificates`, `compliancerules`, `inventorfiles`, `catalogattachments` | 0; `certificates`, `compliancerules` — по смыслу нужны паспортам/ГОСТ, пока пусты |

**Итог по числам:**

- Живые (свежие записи, 2026-10): 36 таблиц data-core и общих.
- Сиды без движения с 2026-09-12 (42 дня): `counterpartyroles`, `currencies`, `dictionary_labels`, `document_template_categories`, `entitystatuses`, `migration_flags`, `orgroles`, `statusworkflows`, `table_templates`, `text_block_categories` — спящие.
- Кандидаты в мёртвые (пусто/старое **и** dc не пишет): пустые CRM-таблицы (43 штуки, список выше), `attributedefinitions`, `entityattributevalues`, `productphotos`, `productmodulephotos`, `mutation_journal`, `migration_flags`, `counterparties`+`counterpartyroles`.
- Спящие (пусто, но модуль dc есть): `organizationcontacts`, `sites`, `productmodules`.
- В корзине (soft-delete) всего **24**: `supplyrequests` 11, `products` 5, `productpassports` 3, `categories` 2, `materials` 2, `warehouses` 1.

## 3. Что нужно data-core без kppdf (критерий 3)

Вывод по коду и числам; решает пользователь.

| Что | Откуда · записей | Куда в data-core | Срочность |
|--|--|--|--|
| Контрагенты-заказчики с ИНН/банком | `counterparties` **0** | переносить нечего; заказчиков из `salesorders` (37) / `incomes` (143) связать по id с `organizations` (25) вместо текста | высокая — заказчик пока текст |
| Сотрудники/исполнители | `workers` **0** | переносить нечего; `persons` (5) уже главный | снята |
| История заказов, счетов, договоров, КП | `orders`, `invoices`, `contracts`, `quotations`, `shipments`, `reconciliation_acts` — **все 0** | нечего переносить в этой базе; решается при отключении kppdf (п.5) | ждёт отключения kppdf |
| Шаблоны документов и текстовые блоки | `document_templates` 21, `doc_types` 6, `text_blocks` 0 | нужны, если КП/договоры печатаются из data-core; паспортам не нужны | по желанию |
| Подписи видов | `dictionary_labels` 8 | в `dict_values` | низкая |
| Сертификаты, правила соответствия | `certificates` 0, `compliancerules` 0 | к паспортам/ГОСТ | по желанию |
| Системные: `users` 7, `roles` 5, `permissions` 33, `featureflags` 5, `settings` 6, `counters` 8, `auditlogs` 329, `idempotency_records` 19, `rate_limit_entries`, `desktop_pairing_keys` 1, `browserdevicegrants` 8, `deviceinvites` 11 | общие | остаются | — |
| Общие каталоги: `materials` 261, `products` 252, `productmodules` 0, `categories` 21, `units` 11, `currencies` 1, `worktypes` 9, `photos` 1093, `sites` 0, `organizations` 25, `persons` 5, склад (`storageitems` 259, `stockmovements` 150, `reservations` 3, `warehouses` 2) + `supplyrequests` 188 | общие | остаются главными | — |

Остальные таблицы CRM (корзина, тендеры, служебные записки, РПП, производство, импорт, журнал мутаций) data-core не нужны: все пусты; при отключении kppdf — архив (дамп), удаление — только по «да» пользователя.

## 4. Порядок объединения (по числам; не исполнялось)

Идём от малых к большим; на каждом шаге — бэкап, план «было → станет · сколько записей · спорные» в этом файле, скрипт `backend/scripts/data-<что>.js` (по умолчанию план, запись только `--apply`), проверка на `datacore-test`, затем показ пользователю.

1. **Цвета** — `color_references` 28 → привести написания в `materials` (261), `storageitems` (259), паспортах, заявках (188). Ключ — RAL-код.
2. **Единицы** — `units` 11 → строки `unit` в тех же таблицах (~700 значений). Ключ — сокращение.
3. **Категории** — `categories` 21 → текстовые `category` в заявках и доходах; `passportCategories` не трогать.
4. **Прочие значения** (`dict_values` 206 vs поля заявок/доходов): форма оплаты, вид счёта, услуги — без регистра/ё/пробелов.
5. **Организации внутри себя** — `organizations` 25: дубли по ИНН/названию, затем привязка текстовых заказчиков (`salesorders` 37, `incomes` 143, `supplyrequests` 188) по id.
6. **Сотрудники** — `persons` 5 vs `users` 7 по ФИО (связь, не слияние).
7. **Изделия** — `products` 252 / `productpassports` 337: сверка артикулов (`skuKey`), 5 «лишних» изделий.
8. **Материалы** — `materials` 261: одинаковые позиции с разным написанием (RAL/размер) — самый дорогой шаг, последний; плюс 2 материала без остатка.

`counterparties`→`organizations` и `workers`→`persons` **из плана исключены** (в источнике 0 записей); вернуться к ним при отключении kppdf, если kppdf к тому времени начнёт их заполнять. Пока работает kppdf — его таблицы и строки не ломаем; слияние — «добавить в главную + ссылка», а не «удалить из дубля».

## 5. Решения координатора 2026-10-24

1. Подсчёт сделан (п.0, п.2).
2. Главная для контрагентов — `organizations`, ключ ИНН. kppdf пока остаётся на своей `counterparties` (сейчас в ней 0).
3. История заказов/счетов/договоров/КП kppdf — не переносить сейчас, остаётся в kppdf; решать при отключении kppdf (в этой базе таблицы пусты).
4. Производство — архив kppdf, в data-core не планируется (11 таблиц, все пусты).
5. Корзина (`cart_items`, `cart_sessions`), тендеры, служебные записки (`desknotes`), РПП — не трогаем, помечены «кандидат в архив»; удаление — только по «да» пользователя. Все пусты.
6. Люди — один список `persons` (Фаза Л); `workers` сопоставлять по ФИО на шаге объединения (сейчас пусты).
7. `app_supply_invoices` остаётся; удаление — только по «да» пользователя (в снимке 2026-10-24 такой таблицы нет).

**✅ Проверено координатором 2026-10-24 (только чтение): противоречия нет.** В Mongo на VM одна рабочая база — `datacore` (других нет), отдельного контейнера Mongo у kppdf нет, `kppdf-backend` работает на ней. Таблицы kppdf пусты, потому что в CRM заказы и контрагентов не вели: работа идёт в «Рабочем месте». Отключение kppdf данных data-core не теряет. Было:  по AGENTS.md kppdf пишет в ту же базу `datacore`, но все его бизнес-таблицы пусты (заказы, счета, контрагенты, производство — 0; живых CRM-таблиц с данными только `document_templates` 21 и `doc_types` 6). Либо kppdf в этой базе не работает/пишет в другую, либо данные ещё не сюда перенесены. Проверить, прежде чем строить на этом отключение kppdf.

### Только по вашему «да» (удаление)

Ничего не удалено. Кандидаты (по числам 2026-10-24); удаление таблицы = `drop` коллекции, делает только координатор по отдельному «да»:

| Кандидат | Записей | Примечание |
|--|--|--|
| 43 пустых CRM-таблицы (см. 2.4: документооборот, продажи/закупки, производство, импорт и пр.) | 0 | пустые, но их схемы читает kppdf — удалять при отключении kppdf, не раньше |
| `cart_items`, `cart_sessions`, `tenders`, `desknotes`, `rpps` | 0 / 0 / 0 / 0 / 0 | «кандидат в архив» (решение 5) |
| `attributedefinitions`, `entityattributevalues` | 0 / 0 | EAV не запущен |
| `productphotos`, `productmodulephotos` | 0 / 0 | связи не используются |
| `counterparties`, `counterpartyroles` | 0 / 4 | после отключения kppdf |
| `mutation_journal`, `migration_flags` | 2 / 1 | служебные kppdf |
| `app_supply_invoices` | нет в снимке | удалять нечего |
| Записи в корзине (soft-delete) | 24 (supplyrequests 11, products 5, productpassports 3, categories 2, materials 2, warehouses 1) | отдельный вопрос: очистить корзину навсегда? Не трогаем |
