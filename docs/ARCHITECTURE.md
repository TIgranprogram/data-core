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

Vanilla JS без сборки: `admin.js` (вся логика, fetch к `/api`, JWT в памяти/хранилище), `index.html`, `admin.css`. Разделы: Пользователи, API-ключи, Таблицы (реестр коллекций из `collections-admin.controller.ts`; удаление разрешено только `kind:'legacy'` и `kind:'app'` — данные приложений, P1; с вводом имени для подтверждения). Локально монтируется томом (правка без пересборки), в prod копируется в образ.

## Инфраструктура

- Локально: Windows, Docker Desktop; порты `HOST_PORT=3001`, `MONGO_PORT=27018` (3000/27017 заняты другим контуром).
- VM (Synology, Ubuntu, Celeron без AVX → mongo 4.4): `/opt/data-core`, данные `/var/lib/datacore`, рядом прод kppdf на `:3000` — не трогать.
- Бэкап: `deploy/synology/backup.sh` (mongodump от root) по cron 03:00, ротация 14 дней; сверка восстановления — `deploy/synology/verify-restore.js`.
- Деплой: `deploy/synology/deploy.py` (skill `datacore-deploy`).
