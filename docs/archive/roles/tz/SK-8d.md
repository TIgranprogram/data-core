# ТЗ SK-8d — сервер не отдаёт данные скрытых разделов

**Зачем (словами пользователя, 2026-10-24):** «нам не нужно отдавать данные, если раздел не показываем — это облегчит загрузку приложения и обезопасит».

**Роли:** архитектор ☐ (сначала — таблица) · backend ☐ · frontend ☐ · qa ☐ · координатор — выкладка

## Правила (решение пользователя и координатора)
- Раздел закрыт = у роли пользователя есть `appSections` (непустой) и раздела в нём нет. `sections: null` (роль без галочек), admin, владелец — без ограничений, как сейчас. CRM kppdf (прямо в базе) не затрагивается.
- Ключи `kppd_`: правило то же, что у роли ключа (своя роль с галочками — ограничен; встроенная без галочек — как сейчас). Архитектор подтверждает или пишет «⚠ Противоречие».
- Закрытый раздел → 403 по-русски: «Раздел «…» для вашей роли закрыт».
- **Короткие поиски для соседних разделов остаются** (пример: выдача на складе под позицию заказа — `GET /salesorders/:id/lines-lookup` и поиск заказа; заявка — поиск позиции склада). Они отдают только нужные поля, не весь раздел.
- Общий поиск («всё о заказе», глобальный поиск) и «Требуют заполнения» (`/fill-audit`) — отдают только данные открытых разделов (остальные группы пустые / отсутствуют).
- «Сегодня» (`home`) всегда открыт, но его сводки — только по открытым разделам.
- Разделы роли — **кэш в памяти** (как кэш baseRole в `common/roles-hierarchy.ts`), не чтение из базы на каждый запрос; смена галочек у роли действует сразу, без перевхода (кэш обновляется в `RoleService` create/update/remove).
- Будущий раздел **design** («Проектирование», маршруты `/api/design-tasks`, ТЗ `docs/roles/tz/PRJ.md` — только читать) — сразу в таблицу и в `common/app-sections.ts` (если там его нет — добавить id `design` с названием «Проектирование»; маршрута пока нет — проверка просто готова).
- Права на изменение не меняются: раздел = что видно; «права как у» = что можно.

## Шаг 1 — архитектор (только отчёт)
Таблица «маршрут (контроллер/префикс) → раздел | короткий поиск для других разделов (каких, какие поля) | всегда открыт». Все контроллеры `backend/src/modules/*`, которые зовёт `backend/pwa` (grep `api('/` в pwa). Отдельно: общий поиск, fill-audit, home-сводки, счётчики меню (`pwa/main.js`), справочники (`/dicts` — по разделу справочника или всегда), фото/файлы, корзина, история. Способ проверки: декоратор `@AppSection('stock')` на контроллер/метод + один глобальный guard после JWT (или иначе — обоснуй), где брать разделы для `kppd_`. Риски: что сломается у соседних разделов.
Координатор вписывает таблицу в этот файл (раздел «Решение архитектора»), потом шаги 2–3.

## Шаг 2 — backend
Guard + декораторы по таблице, кэш разделов роли, фильтр общего поиска / fill-audit / home-сводок, 403 по-русски. Юнит guard'а и кэша; e2e — в зоне qa.

## Шаг 3 — frontend
Не запрашивать данные скрытых разделов: счётчики меню, блоки «Сегодня», предзагрузки. 403 «раздел закрыт» — спокойная подсказка, не падение.

## Шаг 4 — qa
«Кладовщик» (stock+requests): склад и заявки работают целиком, включая выдачу под позицию заказа и поиск позиции в заявке; `/salesorders`, `/finance`, паспорта — 403; поиск и fill-audit без чужих групп. Роль без галочек — всё как раньше. admin — всё. Ключ `kppd_` (встроенная роль и своя роль с галочками). Смена галочек — действует без перевхода.

## Файлы
- В рабочей копии ожидаются правки: `docs/roles/tz/PRJ.md` — **чужой (пользователя / другой сессии): не трогать, не коммитить**.
- читать: `docs/roles/README.md`, этот ТЗ, `SK-8a.md`, `SK-8c.md`, `common/app-sections.ts`, `common/roles-hierarchy.ts`, `common/guards/*`, `modules/auth/strategies/jwt.strategy.ts`, `desktop-pairing-key.service.ts`.

## Критерии приёмки
- [ ] Таблица архитектора закрыта целиком (каждый маршрут pwa — раздел / короткий поиск / всегда).
- [ ] 403 для закрытых разделов; соседние сценарии работают; роль без галочек, admin, CRM — без изменений.
- [ ] Смена галочек — без перевхода; нет запроса в базу за разделами на каждый запрос.
- [ ] Приложение не шлёт запросы к скрытым разделам.
- [ ] tsc 0, юнит затронутого, полный юнит + e2e перед выкладкой.

## Нельзя
- Менять права на изменение; трогать `docs/roles/tz/PRJ.md`; данные прода; коммитить (кроме координатора).

## Решение архитектора (2026-10-24, принято координатором)

Сводок «Сегодня» и общего поиска на сервере нет — `home.js`, `search.js`, `trash.js` опрашивают списки разделов; их закрывает guard. Серверный фильтр нужен только для fill-audit, истории, `/dicts/persons` (зарплата) и карточек «всё о …».

### Маршрут → раздел (пометка на класс, метод может переопределить; несколько = открыт, если открыт любой)
| Маршрут | Раздел(ы) | Зачем соседям |
|--|--|--|
| `/supply/requests*` | requests | — |
| `GET /supply/requests`, `POST /supply/requests`, `POST /supply/requests/:id/receive` | requests, stock | «Приход» (`ops.js`), заявка на нехватку (`stock-ops.js`) |
| `/supply/aliases*` | requests, stock | bulk-match |
| `GET /supply/lookups` | всегда | справочные списки |
| `/stock/*` | stock | — |
| `POST /stock/items`, `POST /stock/items/:id/photos`, `GET /stock/items/:id/ordered` | stock, requests | новая позиция из счёта, item-orders |
| `GET /stock/reservations/order/:id`, `POST /stock/reservations/:id/release` | stock, salesorders | «Брони» в заказе |
| `POST /stock/spec/preview`, `/apply` | stock, salesorders | спецификация из заказа |
| `GET /stock/composition-suggest`, `POST …/accept` | stock, products, salesorders | «Предложено из выдач» |
| **новый** `GET /stock/lookup` → `{items:[{id, materialId, name, article, unit, categoryName, quantity, free}]}` | stock, requests, products | вместо `/stock/items?limit=10000` в `core/stock-list.js` |
| `/salesorders*` | salesorders | — |
| `GET /salesorders/:id/lines-lookup` | salesorders, stock, requests, design | target-picker |
| **новый** `GET /salesorders/lookup?filter=active\|all&lines=1` → `{items:[{id, orderNo, customer, title, stage, shipDate, lines?:[{id, lineNo, title, qty, productId}]}]}`, без денег; объявить до `:id` | salesorders, stock, requests, passports, design | `issue.js orderOptions`, заявка «под заказ» (убирает `/incomes?limit=3000`), `passports/models.js orders()` |
| `/incomes*` | orders, salesorders | строки заказа |
| `GET /incomes/lookups` | всегда | компании, заказчики, формы оплаты |
| `/partners*`, `/organizations/:id/assets/:role` | partners | — |
| `POST /partners` | partners, requests | новый поставщик из заявки |
| `/passports*`, `/products/:productId/passport` | passports | — |
| `GET /passports/phrases` | passports, products | — |
| `/showcase*` | products | — |
| `GET /showcase`, `GET /showcase/:id`, `PUT /showcase/:id/passport-defaults`, `GET/POST /showcase/from-passports` | products, passports (+ orders, salesorders только `GET /showcase`) | паспорт ↔ изделие, выбор изделия в позиции |
| `/finance/*` | money | — |
| `/dicts/persons` | всегда, но **без `salaryKind/salaryRate`, если payroll закрыт** | ФОТ |
| `/design-tasks*` (будущее, PRJ.md) | design | — |
| `/dicts*`, `/photos*`, `/auth/*`, `/meta/*`, `/health/*`, `/desktop`, `/device`, `/apps`, `/settings`, `/feature-flags`, `/version`, `/admin/*` | всегда (без пометки) | — |
| `/audit-logs/record` | по `entityType`: SupplyRequest→requests; Material, StockMovement→stock; Counterparty, Partner→partners; Order, Income→orders, salesorders; SalesOrder→salesorders; Product→products; DictItem→всегда | 403 если закрыт |
| `/audit-logs/app`, `/app/users` | всегда, типы записей — только открытых разделов | — |
| `/fill-audit` | всегда, группы — только открытых разделов | — |
| старые `/materials`; `/products*`, `/modules`, `/product-module-photos`; `/counterparties`, `/organizations` (список); `/persons` | stock; products; partners; payroll | закрыть обход |

### Механизм
- `common/decorators/app-section.decorator.ts`: `@AppSection(...ids)` (класс/метод), `@AppSectionFree()` = `[]` снимает пометку класса.
- `common/guards/app-section.guard.ts` — глобальный `APP_GUARD` **после RolesGuard** (JWT → Permissions → Roles → AppSection). Нет пометки / `[]` / нет `req.user` / `openSectionsFor(user) === null` → пропуск; иначе нужен хотя бы один открытый; нет → 403 «Раздел «<название>» для вашей роли закрыт». Только `Reflector`.
- Кэш в `common/app-sections.ts`: `setRoleSectionsAll`, `setRoleSections`, `deleteRoleSections`, `openSectionsFor(user) → Set|null` (null: isOwner, admin, роль без галочек, роль не в кэше). `RoleService.onModuleInit` грузит все роли `{name, appSections}`; обновлять в create, createCustom, update, remove, resolveForAuth.
- `kppd_`: ключ ограничен разделами роли пользователя-владельца ключа (подтверждено). Внешние скрипты на ключе ограниченной роли получат 403 — так задумано.

### Фильтры
- fill-audit: кэш не трогать; после него копия `groups.filter(g => !open || open.has(g.section))`, пересчёт total; `only=<закрытый>` → `{total:0, groups:[]}`.
- `audit.controller.ts`: record — по entityType; app/app-users — сузить `RECORD_HISTORY_TYPES`.
- Карточки: `salesorders.service.get` → `supplyRequests` (requests), `stockMovements` (stock); карточка partners → заказы/суммы (salesorders), заявки (requests), выдачи (stock); `showcase.service.get` → `orderLines` (salesorders), `passports` (passports). Закрыт — `[]`/`null`; флаги из контроллера (`@CurrentUser`).

### Принятые оговорки
- `/incomes` открыт и для «Заказов»: закрытие «Позиций и оплат» не прячет строки заказов от того, у кого открыты «Заказы» (деньги и так режет MoneyMask).
- Галочки действуют на сервере сразу; меню у клиента обновится после `/auth/me` — до этого закрытый раздел даст спокойную подсказку 403.

### Разбивка (без пересечений)
- **backend** (`backend/src/**`, `docs/MAP.md`, `docs/openapi.json`): app-sections (+ `design` «Проектирование»), декоратор, guard + spec, app.module, role.service (кэш + юнит), пометки на контроллерах по таблице, два lookup, фильтры fill-audit / audit / dicts persons / карточек.
- **frontend** (`backend/pwa/**`): `main.js refreshCounts` только по `sees()` (и `.catch`); `core/api.js` — русский текст 403 сервера; `search.js`, `trash.js` — SOURCES по `sees()`; `core/stock-list.js` → `/stock/lookup` (если нет stock — всегда? см. ниже); `issue.js`, `salesorders.js` (orderOptions, activeOrders), `passports/models.js` → `/salesorders/lookup`; `passports/common.js ourCompanies` → `/incomes/lookups`; прятать кнопки соседних разделов (в заказе «Брони», «Спецификация», «Выпустить паспорт», «В проектирование»; в изделии — паспорта); `home.js` быстрая заявка только при `sees('requests')`.
- `core/stock-list.js`: использовать `/stock/lookup` всегда, где нужен только поиск позиции (он легче), полный `/stock/items` — только в разделе «Склад».
