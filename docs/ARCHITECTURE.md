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

1. **Middleware:** `RequestIdMiddleware` (все), `IdempotencyMiddleware` (POST/PUT/PATCH/DELETE; заголовок `Idempotency-Key` → повтор отдаёт сохранённый ответ), helmet, compression, CORS.
2. **Guards:** `ThrottlerBehindAuthGuard` (rate-limit, ставится в `main.ts`; `DISABLE_THROTTLE=1` только dev/test) + в `app.module.ts` строго по порядку `JwtAuthGuard` → `PermissionsGuard` → `RolesGuard` (порядок не менять — от него зависят тексты 403).
   - `JwtAuthGuard`: `@Public()` пропускает. Иначе берёт токен из `X-Access-Token` или `Authorization: Bearer`. Если токен начинается с `kppd_` — это машинный ключ: `DesktopPairingKeyService.authenticateBearer` → `req.user` = пользователь, выдавший ключ (его роль и права) + `keyScope` (`{access:'read'|'write'|'full', apps?}`, нет в БД → `full`). Иначе — JWT (passport `jwt`, `keyScope` нет). Затем проверка, что пользователь и его роль активны (кэш `user-activity-cache`). Для ключа — scope (`common/guards/key-scope.ts`): `read` → только GET/HEAD/OPTIONS; `read`/`write` → 403 на админ-маршрутах (`/api/admin/*`, `/api/desktop/pairing*`, `/api/roles*`, запись `/api/users*`). `apps` проверяет модуль app-data.
   - `PermissionsGuard`: `@Permissions('x:y')` — нужна capability из каталога `common/seed/permissions.constants.ts`.
   - `RolesGuard`: `@Roles('admin', …)` — легаси-проверка по имени роли; AND с permissions.
3. **ValidationPipe** (глобально): `whitelist + forbidNonWhitelisted + transform` — **лишнее поле в теле → 400**.
4. **Interceptors:** `IdNormalizeInterceptor` (`id` рядом с `_id`), `UserContextInterceptor` (кладёт актора в AsyncLocalStorage → плагины Mongoose видят, кто пишет), `AuditInterceptor` (+ `@AuditAction`) → `auditlogs`.
5. **Filters:** `VersionConflictFilter` (optimistic lock → 409), `MulterExceptionFilter` (413/400), `HttpExceptionFilter` (общий; `CastError` → 400, единый формат ошибки).

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

- Локально: Windows, Docker Desktop; порты `HOST_PORT=3001`, `MONGO_PORT=27018` (3000/27017 заняты другим контуром).
- VM (Synology, Ubuntu, Celeron без AVX → mongo 4.4): `/opt/data-core`, данные `/var/lib/datacore`, рядом прод kppdf на `:3000` — не трогать.
- Бэкап: `deploy/synology/backup.sh` (mongodump от root) по cron 03:00, ротация 14 дней; сверка восстановления — `deploy/synology/verify-restore.js`.
- Деплой: `deploy/synology/deploy.py` (skill `datacore-deploy`).

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
- **Склад и снабжение — общие коллекции CRM** (`materials`, `storageitems`, `stockmovements`, `reservations`, `warehouses`, `supplyrequests`): CRM пишет их напрямую, «Рабочее место» (`/app/`) и синхронизация Google-таблиц — через модули data-core `stock` / `supply` / `sheets-sync`. Схемы — копии kppdf; менять только синхронно. Подробно — [UNIFY-SUPPLY-WAREHOUSE.md](UNIFY-SUPPLY-WAREHOUSE.md).
- **Хозяин данных — приложение** (с 2026-10-19, PRODUCT «Решения»): запись, изменённая или удалённая в приложении, получает `editedInApp`, и синхронизация таблиц её больше не перезаписывает и не воскрешает.
- Откат: `deploy/synology/README.md` → «Единая база: откат».

## Кэш тяжёлых списков (скорость С9, 2026-10-22)

`common/data-version/DataVersionService` (глобальный модуль): при старте открывает поток изменений MongoDB на всю базу (`db.watch`, replica set rs0 обязателен) и считает версии по коллекциям. `cached(scope, коллекции, параметры, fn)` — расчёт один раз на сочетание «версии нужных коллекций + параметры»; одновременные запросы ждут один расчёт; до 40 записей. Запись в базу из любого места (data-core, CRM kppdf, синхронизация таблиц) меняет версию — следующий запрос считает заново. Поток недоступен или `NODE_ENV=test` / `DATA_VERSION_CACHE=off` — кэш выключен, всё считается как раньше. Сейчас подключены: склад `StockService.listItems` (строки до фильтра/сортировки), список паспортов, «Требуют заполнения». Правило: результат кэша общий — потребитель его не меняет (копирует перед сортировкой/правкой); список коллекций расчёта — полный (забыли коллекцию → устаревшие данные).

## Общие хелперы (АБЗ-1, 2026-10-23)

Модули `modules/*` не импортируют друг друга по кругу (взаимных пар — 0; проверка: `node backend/scripts/audit-cycles.js`, `-v` — откуда связь). Общее, из-за чего были циклы, лежит в `common/`: `common/catalog/` — состав изделия (composition-line), граф «где используется» (catalog-graph), ссылки CRM (catalog-references), category-resolver, схемы `Product` и `ProductModule` (их моделями пользуются оба модуля); `common/text/` — `normText`, `search-norm`, `order-key`. Новое общее — сюда, а не импортом из соседнего модуля; после правки — снова `audit-cycles.js`.
