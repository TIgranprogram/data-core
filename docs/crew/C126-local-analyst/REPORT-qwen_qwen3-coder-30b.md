# C126 — отчёт модели qwen/qwen3-coder-30b (домашний ПК, 2026-11-15 21:13)

## Задача 1 — методы без проверки ролей
Проверено: список методов без @Roles/@Public/@Permissions в backend/src/modules/attribute-definition/attribute-definition.controller.ts, backend/src/modules/auth/auth.controller.ts, backend/src/modules/entity-attribute-value/entity-attribute-value.controller.ts, backend/src/modules/meta/meta.controller.ts, backend/src/modules/showcase/showcase.controller.ts, backend/src/modules/user/user.controller.ts

Находки:
- backend/src/modules/attribute-definition/attribute-definition.controller.ts:21 @Get() — получение списка определений атрибутов — проверить человеку
- backend/src/modules/attribute-definition/attribute-definition.controller.ts:26 @Get(':id') — получение определения атрибута по ID — проверить человеку
- backend/src/modules/auth/auth.controller.ts:120 @Get('me') — информация о текущем пользователе — нормально, что видит любой сотрудник
- backend/src/modules/entity-attribute-value/entity-attribute-value.controller.ts:45 @Get(':entityType/:entityId/attributes') — атрибуты сущности — проверить человеку
- backend/src/modules/meta/meta.controller.ts:33 @Get('schema') — схема данных — проверить человеку
- backend/src/modules/meta/meta.controller.ts:42 @Get('openapi.json') — документация API — проверить человеку
- backend/src/modules/meta/meta.controller.ts:50 @Get('guide') — руководство пользователя — проверить человеку
- backend/src/modules/showcase/showcase.controller.ts:174 @Get(':id/variants') — варианты товара — проверить человеку
- backend/src/modules/user/user.controller.ts:42 @Get(':id') — информация о пользователе по ID — проверить человеку

Не уверен: Необходимо уточнить, какие именно данные доступны через эти эндпоинты и насколько они чувствительны.

## Задача 2 — модули без описания в docs/MAP.md
Проверено: список модулей, не описанных в docs/MAP.md

Находки:
- ColorReferenceModule — папка: color-reference — маршрут: @Controller('color-references') — управление справочником цветов
- DataVersionModule — папка: ? — маршрут: нет — управление версиями данных
- DeviceEnrollmentModule — папка: device-enrollment — маршрут: @Controller('device'), @Controller('admin/devices') — регистрация устройств
- DictionaryLabelModule — папка: dictionary-label — маршрут: @Controller('dictionary-labels') — работа со словарными метками
- FillAuditModule — папка: fill-audit — маршрут: @Controller('fill-audit') — аудит заполнения данных
- LoggerModule — папка: ? — маршрут: нет — логирование событий
- MyTasksModule — папка: my-tasks — маршрут: @Controller('my-tasks') — управление задачами пользователя
- PermissionsBootModule — папка: ? — маршрут: нет — инициализация прав доступа
- RateLimitModule — папка: rate-limit — маршрут: @Controller('rate-limits') — ограничение частоты запросов
- RoleCounterpartyModule — папка: role-counterparty — маршрут: @Controller('counterparty-roles') — роли контрагентов
- RoleOrgModule — папка: role-org — маршрут: @Controller('org-roles') — роли организаций

## Задача 3 — переменные окружения без описания в .env.example
Проверено: список переменных окружения, не описанных в .env.example

Находки:
- Всего переменных: 52
- Переменные, похожие на секрет (KEY, SECRET, PASSWORD, TOKEN, URI) — высокая важность:
  - BACKUP_SECRET_KEY — используется в backend/src/modules/disk/offsite.ts
  - DEVICE_GRANT_SECRET_BYTES — используется в backend/src/config/configuration.ts
  - DEVICE_INVITE_SECRET_BYTES — используется в backend/src/config/configuration.ts
  - DEVICE_OWNER_INVITE_TTL_MINUTES — используется в backend/src/config/configuration.ts
  - DISABLE_SECRET_VALIDATION — используется в backend/src/config/secret-validation.service.ts
  - OFFSITE_SMB — используется в backend/src/modules/disk/offsite.spec.ts, backend/src/modules/disk/offsite.ts
  - OFFSITE_SMB_AUTH_DIR — используется в backend/src/modules/disk/offsite.spec.ts, backend/src/modules/disk/offsite.ts
  - SENTRY_DSN — используется в backend/src/main.ts
- Остальные переменные (сгруппированы по модулю):
  - APP_VERSION, CORS_ORIGINS, DATA_VERSION_CACHE, DEVICE_COOKIE_NAME, DISABLE_PASSWORD_DRIFT_CHECK, HA_AUTO_REFRESH_MIN, HA_PEER_URL, HA_SELF, HA_SWITCH_DIR, HOST_BUNDLES_DIR, HOST_DATA_DIR, HOST_REQUESTS_DIR, HTTP_REQUEST_TIMEOUT_MS, JWT_REFRESH_TOKEN_TTL, KPPDF_PUBLIC_ORIGIN, OPENAPI_OUT, ORDER_PDF_OUT, PDFV, PROBE_PDF, PUBLIC_BASE_URL, PWA_VERSION_FILE, QR_BASE_URL, TRUST_PROXY, UPLOAD_DIR — используются в различных модулях (control, desktop, disk, document-render, salesorders, product-passport, qr, apps)

## Задача 4 — проглоченные ошибки в приложении
Проверено: файлы с наибольшим числом .catch(() => {})

Находки:
- backend/pwa/sw.js — 3 места, все фоновые запросы к API, нормально
- backend/pwa/sections/request-fill.js — 3 места, получение данных для заполнения формы, нормально
- backend/pwa/sections/orders.js — 3 места, получение данных заказов и предложений, нормально

Не уверен: Необходимо дополнительно проверить, как именно обрабатываются ошибки в этих местах, чтобы убедиться, что они действительно не критичны.

## Задача 5 — самые большие файлы
Проверено: файлы больше 800 строк

Находки:
- backend/src/modules/product-passport/product-passport.service.ts — содержит методы для работы с паспортами продуктов, включая создание, редактирование, поиск и управление версиями; разбиение на части: основные операции (создание, редактирование, удаление), работа с очередями и номерами, методы для получения данных по заказам и выгрузке, функции для работы с изображениями и техническими данными
- backend/src/modules/dicts/dicts.defs.ts — не содержит кода (пустой файл); разбиение на части: отсутствует содержимое
- backend/src/modules/supply/supply.service.ts — содержит методы для управления поставками, включая создание, обновление, получение и удаление записей; разбиение на части: основные операции поставок, работа с фото, методы для получения данных по поставкам, методы для работы с квитанциями
- backend/src/modules/supply/supply-invoice.service.ts — содержит методы для управления счетами поставок, включая создание, обновление, получение и удаление записей; разбиение на части: основные операции по счетам, работа с линиями счета, методы для работы с оплатой и объединением счетов


---
Итог раннера: задач 5/5 · 1 мин 59 с · шагов 21 · вызовов 22 · отказов 0 · токенов ответа 2477 (21 ток/с в среднем по прогону)
