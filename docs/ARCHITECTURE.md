# ARCHITECTURE — как устроен data-core

> Коротко и только про действующий код. Карта модулей — [MAP.md](MAP.md). Старая архитектура kppdf-8.0 удалена (есть в git до коммита этой правки).

## Схема

```
клиент ──HTTP──> NestJS (backend, :3000 в контейнере; :3001 на хосте) ──> MongoDB 4.4 rs0 (--auth, 127.0.0.1 only)
                  │  /api/*     REST
                  │  /admin/*   статическая админка (backend/admin)
                  │  /uploads/* загруженные фото
                  └  /docs      Swagger UI (только не-prod или SWAGGER_ENABLED=true)
```

Docker Compose (`docker-compose.yml`): `mongo-keyfile` (одноразово пишет keyfile) → `mongo` → `mongo-init` (rs.initiate) → `mongo-appuser` (пользователь `datacore`) → `backend`. Данные — `${DATA_DIR}/mongodb`, `${DATA_DIR}/uploads`.

## Путь запроса

1. **Middleware:** `RequestIdMiddleware` (все), helmet, compression, CORS.
2. **Guards:** `ThrottlerBehindAuthGuard` (rate-limit, ставится в `main.ts`; `DISABLE_THROTTLE=1` только dev/test) + в `app.module.ts` строго по порядку `JwtAuthGuard` → `PermissionsGuard` → `RolesGuard` (порядок не менять — от него зависят тексты 403).
   - `JwtAuthGuard`: `@Public()` пропускает. Иначе берёт токен из `X-Access-Token` или `Authorization: Bearer`. Если токен начинается с `kppd_` — это машинный ключ: `DesktopPairingKeyService.authenticateBearer` → `req.user` = пользователь, выдавший ключ (его роль и права) + `keyScope` (`{access:'app'|'read'|'write'|'full', apps?}`, нет в БД → `full`). Иначе — JWT (passport `jwt`, `keyScope` нет). Затем проверка, что пользователь и его роль активны (кэш `user-activity-cache`). Для ключа — scope (`common/guards/key-scope.ts`): `read` → только GET/HEAD/OPTIONS; `read`/`write` → 403 на админ-маршрутах (`/api/admin/*`, `/api/desktop/pairing*`, `/api/roles*`, запись `/api/users*`). `apps` проверяет модуль app-data. Режим `app` разрешает только обработчики хранилища одного имени и при каждом запросе проверяет актуальные права выдавшего. Общие данные, администрирование и физическое удаление для этого режима закрыты.
   - `PermissionsGuard`: `@Permissions('x:y')` — нужна capability из каталога `common/seed/permissions.constants.ts`.
   - `RolesGuard`: `@Roles('admin', …)` — легаси-проверка по имени роли; AND с permissions. Иерархия — `common/roles-hierarchy.ts` (`effectiveRoles`).
   - **Свои роли (SK-8c):** документ `roles` с кодом `r-…` и `baseRole` (одна из `user|manager|accountant|director`). Все проверки прав (`RolesGuard`, `canSeeMoney`/`MoneyMask`, справочники, переходы статусов) идут через `effectiveRoles`/`baseRoleOf` — своя роль получает ровно права `baseRole`; кэш «код → baseRole» в памяти процесса (старт + правка ролей). permissions/pages — от роли `baseRole` (`RoleService.resolveForAuth`). CRM kppdf читает `users.role` напрямую и свою роль не знает — у такого сотрудника в CRM прав менеджера нет (CRM заморожена, допустимо).
3. **ValidationPipe** (глобально): `whitelist + forbidNonWhitelisted + transform` — **лишнее поле в теле → 400**.
4. **Interceptors:** `IdempotencyInterceptor` проверяет кеш после guards. Повтор привязан к аутентифицированному пользователю, типу и экземпляру ключа, запросу с query и текущим правам. Маршруты выдачи учётных данных и квитанции загрузки проходят без кеширования. `IdNormalizeInterceptor` (`id` рядом с `_id`), `UserContextInterceptor` (кладёт актора в AsyncLocalStorage → плагины Mongoose видят, кто пишет), `AuditInterceptor` (+ `@AuditAction`) → `auditlogs`.
5. **Filters:** `VersionConflictFilter` (optimistic lock → 409), `MulterExceptionFilter` (413/400), `HttpExceptionFilter` (общий; `CastError` → 400, единый формат ошибки; в409 сохраняет неотрицательные целые `currentVersion/currentTreeRevision` и явный `plan.readOnly=true` для сверки).

Пакетная отправка счетов C171 проверяет права и билет до разбора тела PDF. Сервер хранит только хеш билета и привязывает подтверждение к контуру, владельцу, складу и версии. PDF хранится в закрытом каталоге; выдача проверяет наличие зафиксированной карточки оригинала. [Границы и восстановление](crew/C171-document-intake-review/DELIVERY.md)

Закрытие договора по C188 и операции записи используют общий ключ договора `passportGuard` в той же сессии MongoDB. Фиксация активной версии и временного состояния команды происходит атомарно с сохранением комплекта. Исторические файлы читаются из указанной архивной версии. Обычный переход этапа не снимает архивную защиту. [Контракт](crew/C188-order-archive/CONTRACT.md)

## Слой данных

- Подключение и **глобальные плагины** — `database/database.module.ts`: `soft-delete` (запросы скрывают `deletedAt != null`; `.softDelete()`), `audit` (createdBy/updatedBy), `user-context`.
- `common/mongoose/optimistic-lock.plugin.ts` — версионирование там, где подключён.
- Транзакции требуют replica set (поэтому rs0 даже на одном узле).
- Идентификатор: глобальный `IdNormalizeInterceptor` (T18) добавляет строковый `id` рядом с `_id` в каждый объект ответа (аддитивно). Списки: `{ items, total, page, limit }`.
- Данные приложений (P1, `modules/app-data`): `/api/apps/:app/:collection` пишет в сырые коллекции `app_<app>_<collection>` через Connection, без Mongoose-схем — глобальные плагины туда не действуют, служебные поля (`createdAt/updatedAt/createdBy/updatedBy/deletedAt`) и soft-delete ставит сам сервис. `filter` — только whitelist операторов (`app-data.validation.ts`).
- Мульти-организационность: многие сущности имеют `organizationId`; сервисы фильтруют по организации актора.
- Удаление справочников защищено проверками «где используется» (`where-used`, `catalog-graph`). ⚠ часть проверок смотрит в удалённые CRM-коллекции — TASKS T1.

## Аутентификация и доступ

| Механизм | Где | Суть |
|--|--|--|
| Логин | `POST /api/auth/login` | `{username,password}` → `{access, refresh, user}`; throttle 5/мин, softlock после серии неудач |
| Refresh | `POST /api/auth/refresh` | refresh-JWT в `X-Access-Token` или `Bearer`; версия `refreshTokenVersion` у пользователя |
| Машинный ключ | `/api/desktop/pairing-keys` | `kppd_…`, хранится хеш, TTL `1d/7d/30d/90d/never`, revoke; ключ действует от имени выдавшего, урезанный `scope` (`read`/`write`/`full` + `apps`; без scope = `full`) |
| Роли | сид в `common/seed/admin.seed.ts` | `admin` / `director` / `manager` / `user` + права из каталога (виды работ правятся по `production:write` — наследие kppdf) |
| Owner | `user.isOwner` | seeded admin = owner; owner скрыт от не-owner акторов, последнего админа удалить нельзя (`last-admin.guard`) |
| Секреты | `config/secret-validation.service.ts` | в `NODE_ENV=production` слабые/одинаковые JWT-секреты и короткий `ADMIN_PASSWORD` (<12) → процесс не стартует |

## Старт приложения (сиды)

`OnApplicationBootstrap`: permissions → roles → admin (из `ADMIN_USERNAME`/`ADMIN_PASSWORD`, только если пользователя нет) → settings, feature-flags, statuses, units, categories, currencies, colors, org/counterparty roles. `AdminPasswordDriftDetector` предупреждает о дефолтном пароле. `PermissionsBootValidator` сверяет права в декораторах с каталогом.

## Админка (`backend/admin/`)

Vanilla JS без сборки: `admin.js` (вся логика, fetch к `/api`, JWT в памяти/хранилище), `index.html`, `admin.css`. Разделы: Пользователи, API-ключи, Таблицы (поля + просмотр записей), Журнал (аудит с фильтрами), Подключение (адрес, ключ, промт для ИИ, примеры) (реестр коллекций из `collections-admin.controller.ts`; удаление разрешено только `kind:'app'`; таблицы CRM kppdf (`kind:'crm'`) удалить нельзя — данные приложений, P1; с вводом имени для подтверждения). Локально монтируется томом (правка без пересборки), в prod копируется в образ. Отдаётся с `Cache-Control: no-cache` — после деплоя браузер не держит старую версию.

## Инфраструктура

**Локальная работа C156 (19.11.2026):** стабильный пользовательский интерфейс открывается прямо на `https://kppdf-crm.ru/db/app/`, API и файлы остаются на том же origin, главная БД — Synology. Локальная разработка — только owned-run из `tools/night*` с отдельной БД/томами/внутренней сетью и loopback-прокси. `tools/work-modes.mjs start` пересобирает текущий checkout без восстановления поверх имеющейся копии; перед открытием сверяет готовность API и публичный JSON запуска. Неисправность не вызывает fallback или переключение API.

`/app/development.json` в репозитории — пустой объект; в owned compose он подменяется readonly-файлом из gitignored runDir с именем/датой снимка, восстановлением и успешно собранным кодом. На удалённом рабочем origin PWA не запрашивает этот файл. Локальные оболочка/вход и модальные окна показывают отметку разработки; service worker не кэширует метаданные и API. Авто-pull пульта не выполняется при живом обычном/legacy/owned backend или неподтверждённом Docker. Передача между ПК — Git и явная опубликованная WIP-ветка, без переноса БД/секретов; порядок в `crew/C156-work-development-modes/WORKFLOW.md`.

- Локально: Windows, Docker Desktop; порты `HOST_PORT=3001`, `MONGO_PORT=27018` (3000/27017 заняты другим контуром).
- VM (Synology, Ubuntu, Celeron без AVX → mongo 4.4): `/opt/data-core`, данные `/var/lib/datacore`, рядом прод kppdf на `:3000` — не трогать.
- Бэкап: `deploy/synology/backup.sh` (mongodump от root) по cron 03:00, ротация 14 дней; сверка восстановления — `deploy/synology/verify-restore.js`.
- Деплой: `deploy/synology/release.sh` (skill `datacore-deploy`).

### Обновление запасного сервера C166 (подготовлено, выпуск отдельно)

Настройки расписаний хранятся в существующем SwitchDoc отдельно от локальной истории запусков. Запуск захватывается CAS вместе с ключом временного слота; outbox восстанавливает тот же job после рестарта. Код на запасной передаётся только принятым неизменяемым архивом с SHA, без pull рабочей ветки. Общий host gate исключает пересечение обновления с release; неизвестный результат отката/переключения удерживает блокировку до подтверждения. Локальный scheduleRuntime при восстановлении копии сохраняется, конфигурация берётся с главного. Схемы API — MAP.md; границы проверки и host-сценарии — [C166](crew/C166-server-schedules/BRIDGE-REPORT.md). Реальное переключение домена не считается проверенным по изолированным тестам.

## Единая база (с 2026-10-18)

```
Google-таблицы / скрипты / новые приложения ──HTTP + kppd_──> data-core API (:3001, https://kppdf-crm.ru/db/api)──┐
                                                                                                             ├──> MongoDB datacore (datacore-mongo)
CRM kppdf (:3000, https://kppdf-crm.ru) ──────── напрямую, Mongo-пользователь kppdf (readWrite datacore) ─────┘
```
- Одна физическая база `datacore`. Данные kppdf перенесены 2026-10-18 (kppdf — главный источник: его admin, роли, доступы устройств); старая база kppdf (`/var/lib/kppdf80/mongodb`, контейнер `kppdf-mongo` остановлен) хранится для отката.
- Пользователи общие: один логин/пароль в обоих приложениях (JWT-секреты разные — сессии отдельные). Ключи `kppd_` общие: полный (`full`) ключ работает в обоих API, ключ со scope `read`/`write` — **только в data-core** (kppdf отклоняет 401).
- Загрузки общие: `/var/lib/datacore/uploads` смонтирован в оба backend.
- Защита: CRM-таблицы (`kind:'crm'`) и общие с CRM (`kind:'shared'` — склад и снабжение: `materials`, `warehouses`, `storageitems`, `stockmovements`, `reservations`, `supplyrequests`; пишут оба кода, М5) из админки data-core не удаляются; удаление справочника в data-core блокируется ссылками и из каталога, и из CRM (`catalog-references.ts` → `isUsedByCrm`).
- Оба сида досоздают недостающее (права/роли — объединение). kppdf — прямой писатель в БД (исключение из VISION #1, осознанное: тот же код-предок, те же плагины soft-delete/audit). Цель на будущее — kppdf как клиент API data-core.
- **Склад и снабжение — общие коллекции CRM** (`materials`, `storageitems`, `stockmovements`, `reservations`, `warehouses`, `supplyrequests`): CRM пишет их напрямую, «Рабочее место» (`/app/`) и синхронизация Google-таблиц — через модули data-core `stock` / `supply`. Схемы — копии kppdf; менять только синхронно. Подробно — [UNIFY-SUPPLY-WAREHOUSE.md](UNIFY-SUPPLY-WAREHOUSE.md). Рабочий черновик полей и запретов (C257, L-257; diff kppdf открыт): [crew/C257-shared-compat-contract/CONTRACT.md](crew/C257-shared-compat-contract/CONTRACT.md). CRM→API не начат.
- **Совместимость записи (C254, 24.11.2026):** гарантия хозяина — только внутри data-core. Запись этих шести вне `stock/` и `supply/` идёт через `stock-writes` / `supply-writes` и порты. Find/count тех же шести вне хозяев — слой `common/shared-collections` (`sharedFind` / `sharedCount`); агрегат и distinct слоя нет. CRM kppdf по-прежнему пишет и читает коллекции напрямую (пользователь Mongo `kppdf`); слой её не перехватывает. Схемы этой поставкой не менялись. Ход — [C254 REPORT](crew/C254-shared-collections-layer/REPORT.md). Перевод CRM на API не начат.
- **Хозяин данных — приложение** (с 2026-10-19, PRODUCT «Решения»): запись, изменённая или удалённая в приложении, получает `editedInApp`, и синхронизация таблиц её больше не перезаписывает и не воскрешает.
- **C057 (PDM):** в `materials`, `productmodules`, `products` добавлены только необязательные поля `pdm`, `needsName`, у материалов ещё `pdmCode`, `pdmAliases`, `dimSource`, `isProfile`, `profileId`, `isDefaultFormat`, `scrapFactor`; в kppdf схемы не правим (она их не видит).
- Откат: `deploy/synology/README.md` → «Единая база: откат».

## Кэш тяжёлых списков (скорость С9, 2026-10-22)

`common/data-version/DataVersionService` (глобальный модуль): при старте открывает поток изменений MongoDB на всю базу (`db.watch`, replica set rs0 обязателен) и считает версии по коллекциям. `cached(scope, коллекции, параметры, fn)` — расчёт один раз на сочетание «версии нужных коллекций + параметры»; одновременные запросы ждут один расчёт; до 40 записей. Запись в базу из любого места (data-core, CRM kppdf, синхронизация таблиц) меняет версию — следующий запрос считает заново. Поток недоступен или `NODE_ENV=test` / `DATA_VERSION_CACHE=off` — кэш выключен, всё считается как раньше. Сейчас подключены: склад `StockService.listItems` (строки до фильтра/сортировки), список паспортов, «Требуют заполнения». Правило: результат кэша общий — потребитель его не меняет (копирует перед сортировкой/правкой); список коллекций расчёта — полный (забыли коллекцию → устаревшие данные).

## Общие хелперы (АБЗ-1, 2026-10-23)

Модули `modules/*` не должны импортировать друг друга по кругу (проверка: `node backend/scripts/audit-cycles.js`, `-v` — откуда связь; скрипт ловит **взаимные пары**, длинные циклы — отдельно). Общее, из-за чего были циклы, лежит в `common/`: `common/catalog/` — состав изделия (composition-line), граф «где используется» (catalog-graph), ссылки CRM (catalog-references), category-resolver, схемы `Product` и `ProductModule` (их моделями пользуются оба модуля); `common/text/` — `normText`, `search-norm`, `order-key`. В `common/` — типы и чистые функции, не доменные правила. Новое общее — сюда, а не импортом из соседнего модуля; после правки — снова `audit-cycles.js`.

> **Актуальность (C246, 24.11.2026):** фраза «взаимных пар — 0» ниже по истории АБЗ-1 устарела как гарантия «навсегда». Снимок после аудита — [crew/C246-architecture-modularity/REPORT.md](crew/C246-architecture-modularity/REPORT.md); текущее число — только свежий прогон `audit-cycles.js`. Программа хозяев доменов — [C246/CHECKLIST](crew/C246-architecture-modularity/CHECKLIST.md).


### HTTP-логи: заголовки авторизации

C155,19.11: pino-http в AppModule исключает не только Authorization/API-key, но и входной Cookie и ответный Set-Cookie. Удаление касается только сериализации лога: клиентские cookie и авторизация остаются штатными. Регрессия проверяет настоящую фабрику конфигурации и неизменность HTTP-ответа; значения токенов в диагностические отчёты не сохранять.

### C169 — доверие локальному разбору документов

Локальная модель получает только текст, возвращает закрытое предложение с цитатами; API, пути, shell и токены ей не доступны. Исполнитель проверяет цитаты, роли сторон, суммы и типы, затем вызывает разрешённые предметные маршруты. Готовность означает свежую сверку API и фактических байтов, а не успешный ответ модели. Общий response-cache не заменяет квитанцию: новые upload/intake POST исключены из него, уникальность и recovery обеспечивают предметные модели.

Один OS-lock на каноническую папку, ID физического поступления отдельно от SHA/UID документа, durable намерение до перемещения/сети. Переход между контурами или аккаунтами при продолжении запрещён. Избранные исключения повторяются отдельно, завершённые не идут в модель заново. Общий transactional fence служебного счётчика сериализует импорт счёта и обычную/locked правку его идентичности/файлов. Он не распространяется автоматически на внешние прямые записи CRM или сторонние скрипты. Подробности — [C169 ARCH-PLAN](crew/C169-local-document-intake/ARCH-PLAN.md).

Пульт C169 продлевает access по штатному auth/refresh: refresh извлекается из Set-Cookie и подаётся Bearer по JwtRefreshStrategy. Вход в локальную копию запоминается на Windows. Refresh и данные привязки шифруются DPAPI для текущего пользователя, access хранится в памяти. Для рабочего сайта сессия остаётся в памяти брокера. Engine получает provider, привязанный к активной сессии, аккаунту и контуру. Изменение sub/version/role/org, отзыв или неизвестный ответ останавливают импорт; финансовые POST не повторяются из-за обновления авторизации.

## Вложенные складские операции (C242)

Внешняя транзакция correctMovement / undoReceive передаёт ClientSession всем внутренним чтениям и fallback-записям склада. Внутренние move/cancel с outer возвращают void; публичная StockItemView вычисляется после commit. Чтение без session до commit способно ждать заблокированного DDL и удерживать собственную транзакцию. Точный контракт и регрессии — [C242](crew/C242-stock-section-order/ARCH-TX-REVIEW.md).

То же правило действует в withPlanWrite→barsOf планировщика: session передаётся всем источникам расписания и проверкам исполнителя/вида работ; внутри транзакции чтения последовательны, общий worktypes-кэш обходится и не обновляется транзакционными данными. CAS шага, архивные ограничения и ответ после commit сохраняются. [Точечная проверка TX2](crew/C242-stock-section-order/QA-TX2-ARCH.md).
