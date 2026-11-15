## Задача 1 — методы без проверки ролей
Проверено: найдены 8 методов без @Roles/@Public/@Permissions
Находки:
- backend/src/modules/meta/meta.controller.ts:33 — отдаёт схему данных — нормально ли, что любой сотрудник видит схему? (проверить человеку)
- backend/src/modules/meta/meta.controller.ts:42 — отдаёт OpenAPI JSON — нормально ли, что любой сотрудник видит документацию? (проверить человеку)
- backend/src/modules/meta/meta.controller.ts:50 — отдаёт гайд — нормально ли, что любой сотрудник видит гайд? (проверить человеку)
- backend/src/modules/attribute-definition/attribute-definition.controller.ts:21 — отдаёт список атрибутов — нормально ли, что любой сотрудник видит список атрибутов? (проверить человеку)
- backend/src/modules/attribute-definition/attribute-definition.controller.ts:26 — отдаёт атрибут по ID — нормально ли, что любой сотрудник видит атрибут по ID? (проверить человеку)
- backend/src/modules/auth/auth.controller.ts:120 — отдаёт информацию о текущем пользователе — нормально ли, что любой сотрудник видит данные о себе? (проверить человеку)
- backend/src/modules/showcase/showcase.controller.ts:174 — отдаёт варианты товара — нормально ли, что любой сотрудник видит варианты товара? (проверить человеку)
- backend/src/modules/entity-attribute-value/entity-attribute-value.controller.ts:45 — отдаёт атрибуты сущности — нормально ли, что любой сотрудник видит атрибуты сущности? (проверить человеку)
Не уверен: нужно проверить, какие данные возвращаются этими эндпоинтами, и насколько они конфиденциальны.

## Задача 2 — модули без описания в docs/MAP.md
Проверено: список модулей без описания в MAP.md
Находки:
- ColorReferenceModule — папка: color-reference — маршрут: @Controller('color-references') — управление цветами
- DataVersionModule — папка: ? — маршрут: нет — версии данных
- DeviceEnrollmentModule — папка: device-enrollment — маршрут: @Controller('admin/devices') @Controller('device') — регистрация устройств
- DictionaryLabelModule — папка: dictionary-label — маршрут: @Controller('dictionary-labels') — метки словарей
- FillAuditModule — папка: fill-audit — маршрут: @Controller('fill-audit') — аудит заполнения
- LoggerModule — папка: ? — маршрут: нет — логирование
- MyTasksModule — папка: my-tasks — маршрут: @Controller('my-tasks') — задачи пользователя
- PermissionsBootModule — папка: ? — маршрут: нет — инициализация прав
- RateLimitModule — папка: rate-limit — маршрут: @Controller('rate-limits') — ограничение запросов
- RoleCounterpartyModule — папка: role-counterparty — маршрут: @Controller('counterparty-roles') — роли контрагентов
- RoleOrgModule — папка: role-org — маршрут: @Controller('org-roles') — роли организаций

## Задача 3 — переменные окружения без описания в .env.example
Проверено: переменные окружения без описания в .env.example
Находки:
- Всего переменных: 45
- Секреты (KEY, SECRET, PASSWORD, TOKEN, URI): BACKUP_SECRET_KEY, DEVICE_GRANT_SECRET_BYTES, DEVICE_INVITE_SECRET_BYTES, OFFSITE_SMB, OFFSITE_SMB_AUTH_DIR, SENTRY_DSN — высокая важность
- Остальные переменные:
  - control: APP_VERSION, BOOT_RELAX_PERMISSIONS, DATA_VERSION_CACHE, HA_AUTO_REFRESH_MIN, HA_PEER_URL, HA_SELF, HA_SWITCH_DIR, PWA_VERSION_FILE
  - desktop: DESKTOP_DOWNLOAD_URL, DESKTOP_MIN_VERSION, DESKTOP_RECOMMENDED_VERSION
  - disk: HOST_BUNDLES_DIR, HOST_DATA_DIR, HOST_REQUESTS_DIR, OFFSITE_SMB, OFFSITE_SMB_AUTH_DIR
  - config: DEVICE_COOKIE_NAME, DEVICE_ENROLL_BASE_URL, DEVICE_GRANT_TTL_DAYS, DEVICE_INVITE_TTL_DAYS, DEVICE_JWT_TTL_SECONDS, DEVICE_OWNER_INVITE_TTL_MINUTES, JWT_REFRESH_TOKEN_TTL
  - seed: DISABLE_PASSWORD_DRIFT_CHECK
  - guards: DISABLE_SECRET_VALIDATION, DISABLE_THROTTLE, TRUST_PROXY
  - document-render: KPPDF_PUBLIC_ORIGIN, PUBLIC_BASE_URL
  - salesorders: ORDER_PDF_OUT
  - product-passport: PDFV, PROBE_PDF
  - qr: QR_BASE_URL
  - photos: UPLOAD_DIR
  - main: CORS_ORIGINS, HTTP_REQUEST_TIMEOUT_MS, OPENAPI_OUT, SENTRY_DSN

## Задача 4 — проглоченные ошибки в приложении
Проверено: файлы с наибольшим числом .catch(() => {})
Находки:
- backend/pwa/sw.js: 3 места, все фоновые запросы, нормально
- backend/pwa/sections/request-fill.js: 3 места, все фоновые запросы, нормально
- backend/pwa/sections/orders.js: 4 места, часть — сохранение/загрузка данных, часть — фоновые запросы, некоторые могут скрывать ошибки
Не уверен: нужно проверить, какие именно из вызовов в orders.js могут быть критичными

## Задача 5 — самые большие файлы
Проверено: файлы больше 800 строк
Находки:
- backend/src/modules/product-passport/product-passport.service.ts — сервис для работы с паспортами продукции, содержит методы для создания, редактирования, поиска и управления паспортами; разбит на части: основные методы, работа с очередями, методы для создания и редактирования, методы для проверки и управления изображениями
- backend/src/modules/dicts/dicts.defs.ts — определения словарей системы, содержит структуры данных и константы; разбит на части: определения словарей, типы и интерфейсы, константы и значения
- backend/src/modules/supply/supply.service.ts — сервис для работы с поставками, содержит методы для управления заказами и поставками; разбит на части: основные методы, работа с заказами, методы для обработки данных, методы для управления статусами
- backend/src/modules/supply/supply-invoice.service.ts — сервис для работы с инвойсами, содержит методы для создания и обработки инвойсов; разбит на части: методы для создания инвойсов, обработка данных, работа с документами

