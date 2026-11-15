# C126 — отчёт модели gpt-oss-20b (домашний ПК, 2026-11-15 19:56)

## Задача 1 — методы без проверки ролей
Проверено: 9 методов без @Roles/@Public/@Permissions

Находки:
- backend/src/modules/attribute-definition/attribute-definition.controller.ts:21 – Возвращает список всех определений атрибутов (получение списка). Нормально, но доступ открыт всем сотрудникам. — важность: средняя
- backend/src/modules/attribute-definition/attribute-definition.controller.ts:26 – Возвращает конкретное определение атрибута по id. Открытый доступ может раскрыть конфиденциальные данные. — важность: высокая
- backend/src/modules/auth/auth.controller.ts:120 – Возвращает информацию о текущем пользователе (me). Это предназначено для всех авторизованных, нормальный. — важность: низкая
- backend/src/modules/entity-attribute-value/entity-attribute-value.controller.ts:45 – Возвращает атрибуты конкретного существа по типу и id. Открытый доступ может раскрыть конфиденциальные данные. — важность: высокая
- backend/src/modules/meta/meta.controller.ts:33 – Возвращает схему БД (schema). Это публичная информация, нормальный. — важность: низкая
- backend/src/modules/meta/meta.controller.ts:42 – Возвращает openapi.json. Публичный. — важность: низкая
- backend/src/modules/meta/meta.controller.ts:50 – Возвращает guide. Публичный. — важность: низкая
- backend/src/modules/showcase/showcase.controller.ts:174 – Возвращает варианты для конкретного showcase id. Открытый доступ может раскрыть коммерческую информацию, но обычно не чувствительная. — важность: средняя
- backend/src/modules/user/user.controller.ts:42 – Возвращает информацию о пользователе по id. Открытый доступ может раскрыть личные данные; требуется ограничение. — важность: высокая

Не уверен: Нужно уточнить у разработчика, что конкретный список атрибутов не содержит конфиденциальной информации и что пользовательский эндпоинт должен быть защищён.

## Задайка ??? …

## Задача 2 — модули без описания в docs/MAP.md
ColorReferenceModule – папка color-reference – маршрут @Controller('color-references') – делает: предоставляет список цветовых референсов для UI и графических компонентов.
DataVersionModule – папка data-version – маршрут: нет – делает: управляет версиями данных, хранит информацию о последнем обновлении схемы.
DeviceEnrollmentModule – папка device-enrollment – маршруты @Controller('device') @Controller('admin/devices') – делает: регистрирует устройства пользователей, позволяет привязать их к аккаунтам и управлять настройками.
DictionaryLabelModule – папка dictionary-label – маршрут @Controller('dictionary-labels') – делает: хранит метки словарей для локализации и классификации данных.
FillAuditModule – папка fill-audit – маршрут @Controller('fill-audit') – делает: ведёт аудит заполнения форм/данных, регистрирует изменения.
LoggerModule – папка logger – маршрут: нет – делает: обеспечивает логирование событий приложения, предоставляет API для записи логов.
MyTasksModule – папка my-tasks – маршрут @Controller('my-tasks') – делает: управляет задачами пользователя, позволяет создавать, обновлять и удалять задачи.
PermissionsBootModule – папка permissions-boot – маршрут: нет – делает: инициирует систему прав доступа при старте приложения.
RateLimitModule – папка rate-limit – маршрут @Controller('rate-limits') – делает: контролирует частоту запросов к API, предотвращая перегрузки и злоупотребление.
RoleCounterpartyModule – папка role-counterparty – маршрут @Controller('counterparty-roles') – делает: управляет ролями контрагентов в системе.
RoleOrgModule – папка role-org – маршрут @Controller('org-roles') – делает: определяет роли внутри организации, назначает права пользователям.

## Задача 3 — переменные окружения без описания в .env.example
Проверено: 59 переменных (около 60)

Находки:
- Вариантов с ключами/секретами (важность высокая):
  * BACKUP_SECRET_KEY – используется в backend/src/modules/disk/offsite.ts – хранит ключ шифрования бэкапов.
  * DEVICE_GRANT_SECRET_BYTES, DEVICE_INVITE_SECRET_BYTES – в backend/src/config/configuration.ts – содержат секретные байты для выдачи токенов.
  * DISABLE_SECRET_VALIDATION – отключает проверку секретов в конфигурации.
  * JWT_REFRESH_TOKEN_TTL – срок жизни refresh‑токена (секретное значение).
  * DEVICE_JWT_TTL_SECONDS, DEVICE_INVITE_TTL_DAYS, DEVICE_OWNER_INVITE_TTL_MINUTES – таймауты токенов.
  * SENTRY_DSN – DSN для Sentry мониторинга (ключевой секрет).
  * OFFSITE_SMB_AUTH_DIR, OFFSITE_SMB – параметры доступа к SMB‑ресурсу.
- Остальные переменные: 
  * APP_VERSION, DATA_VERSION_CACHE, DESKTOP_DOWNLOAD_URL, DESKTOP_MIN_VERSION, DESKTOP_RECOMMENDED_VERSION – версии и пути (модуль desktop). 
  * CORS_ORIGINS, HTTP_REQUEST_TIMEOUT_MS – настройки запросов (модуль main). 
  * DEVICE_COOKIE_NAME, DEVICE_ENROLL_BASE_URL – параметры регистрации устройств (модуль configuration). 
  * DISABLE_PASSWORD_DRIFT_CHECK, DISABLE_THROTTLE – флаги отключения проверок и ограничения (модули common/seed, common/guards). 
  * HA_AUTO_REFRESH_MIN, HA_PEER_URL, HA_SELF, HA_SWITCH_DIR – параметры хранилища переключателя (модуль switch). 
  * HOST_BUNDLES_DIR, HOST_DATA_DIR, HOST_REQUESTS_DIR – директории хранения данных (модули disk/bundle и control.collect). 
  * KPPDF_PUBLIC_ORIGIN, QR_BASE_URL, PWA_VERSION_FILE, ORDER_PDF_OUT, PDFV, PUBLIC_BASE_URL, TRUST_PROXY – различные пути и публичные URL.

Не уверен: Нужно уточнить у разработчика, что в .env.example перечислены все секреты без значений, а остальные переменные описаны там же с комментариями.

## Задача 2 — модули без описания в docs/MAP.md
Проверено: 11 модулей без описания

Находки:
- ColorReferenceModule – папка color-reference – маршрут @Controller('color-references') – делает: предоставляет список цветовых референсов для UI и графических компонентов.
- DataVersionModule – папка data-version – маршрут отсутствует – делает: управляет версиями данных, хранит информацию о последнем обновлении схемы.
- DeviceEnrollmentModule – папка device-enrollment – маршруты @Controller('device') @Controller('admin/devices') – делает: регистрирует устройства пользователей, позволяет привязать их к аккаунтам и управлять настройками.
- DictionaryLabelModule – папка dictionary-label – маршрут @Controller('dictionary-labels') – делает: хранит метки словарей для локализации и классификации данных.
- FillAuditModule – папка fill-audit – маршрут @Controller('fill-audit') – делает: ведёт аудит заполнения форм/данных, регистрирует изменения.
- LoggerModule – папка logger – маршрут отсутствует – делает: обеспечивает логирование событий приложения, предоставляет API для записи логов.
- MyTasksModule – папка my-tasks – маршрут @Controller('my-tasks') – делает: управляет задачами пользователя, позволяет создавать, обновлять и удалять задачи.
- PermissionsBootModule – папка permissions-boot – маршрут отсутствует – делает: инициирует систему прав доступа при старте приложения.
- RateLimitModule – папка rate-limit – маршрут @Controller('rate-limits') – делает: контролирует частоту запросов к API, предотвращая перегрузки и злоупотребление.
- RoleCounterpartyModule – папка role-counterparty – маршрут @Controller('counterparty-roles') – делает: управляет ролями контрагентов в системе.
- RoleOrgModule – папка role-org – маршрут @Controller('org-roles') – делает: определяет роли внутри организации, назначает права пользователям.

Не уверен: какие из этих модулей не задокументированы в MAP.md и могут быть использованы без описания.

## Задача 3 — переменные окружения без описания в .env.example
Проверено: 59 переменных (около 60)

Находки:
- **Секреты** (важность высокая):
  * BACKUP_SECRET_KEY – хранит ключ шифрования бэкапов.
  * DEVICE_GRANT_SECRET_BYTES, DEVICE_INVITE_SECRET_BYTES – содержат секретные байты для выдачи токенов.
  * DISABLE_SECRET_VALIDATION – отключает проверку секретов в конфигурации.
  * JWT_REFRESH_TOKEN_TTL – срок жизни refresh‑токена (секретное значение).
  * DEVICE_JWT_TTL_SECONDS, DEVICE_INVITE_TTL_DAYS, DEVICE_OWNER_INVITE_TTL_MINUTES – таймауты токенов.
  * SENTRY_DSN – DSN для Sentry мониторинга (ключевой секрет).
  * OFFSITE_SMB_AUTH_DIR, OFFSITE_SMB – параметры доступа к SMB‑ресурсу.
- **Остальные переменные**: 
  * APP_VERSION, DATA_VERSION_CACHE, DESKTOP_DOWNLOAD_URL, DESKTOP_MIN_VERSION, DESKTOP_RECOMMENDED_VERSION – версии и пути (модуль desktop). 
  * CORS_ORIGINS, HTTP_REQUEST_TIMEOUT_MS – настройки запросов (модуль main). 
  * DEVICE_COOKIE_NAME, DEVICE_ENROLL_BASE_URL – параметры регистрации устройств (модули configuration). 
  * DISABLE_PASSWORD_DRIFT_CHECK, DISABLE_THROTTLE – флаги отключения проверок и ограничения (модули common/seed, common/guards). 
  * HA_AUTO_REFRESH_MIN, HA_PEER_URL, HA_SELF, HA_SWITCH_DIR – параметры хранилища переключателя (модуль switch). 
  * HOST_BUNDLES_DIR, HOST_DATA_DIR, HOST_REQUESTS_DIR – директории хранения данных (модули disk/bundle и control.collect). 
  * KPPDF_PUBLIC_ORIGIN, QR_BASE_URL, PWA_VERSION_FILE, ORDER_PDF_OUT, PDFV, PUBLIC_BASE_URL, TRUST_PROXY – различные пути и публичные URL.

Не уверен: Нужно уточнить у разработчика, что в .env.example перечислены все секреты без значений, а остальные переменные описаны там же с комментариями.

## Задача 4 — проглоченные ошибки в приложении
Проверено: 3 файлов с наибольшим числом `.catch(() => {})` – `backend/pwa/sw.js`, `backend/pwa/main.js`, `backend/pwa/sections/request-fill.js`

Находки:
- **backend/pwa/sw.js** – содержит ~10 вызовов `.catch(() => {})`. Ошибки от сетевых запросов, кеширования и инит‑процессов перехватываются без логирования. Нормально для фоновых процессов, но потенциально скрывает критические сбои при регистрации сервис‑воркера.
- **backend/pwa/main.js** – в цикле `loadSec(k).catch(() => {});` и других местах. Ошибки от загрузки секций и данных пользователея перехватываются без сообщений. Это нормально для UI, но может скрыть ошибки при рендеринге.
- **backend/pwa/sections/request-fill.js** – в API‑запросах `.catch(() => null)`. Ошибки сетевых запросов к `/materials/...` и `/supply/catalog/items` перехватываются с возвратом `null`, что скрывает проблемы при загрузке цен. Нормально для пользовательских запросов, но может привести к неясному поведению.

Не уверен: Нужно уточнить у разработчика, что в случае критических ошибок (например, невозможность получить цены) пользователь получает пустой результат без уведомления.

## Задача 5 — самые большие файлы
Проверено: один файл `backend/src/modules/product-passport/product-passport.service.ts`

Внутри файла:
- **Методы чтения** – `list`, `phrases`, `models`, `byOrder`, `facets` (получение данных о паспортах, их описаний и связей).
- **Операции изменения** – `bulk`, `issue`, `annul`, `queue`, `setNextNumber`, `createReady`, `duplicate` (сборка массовых изменений и управление статусом паспортов).
- **Сохранение/удаление файлов** – `savePrintFile`, `removePrintFile`, `restore`, `editSnapshotItem`, `promoteSnapshotItem` (работа с печатными файлами и снимками)

Разбить файл можно на 3–4 части:
1. **Инициализация и получение данных** – конструктор, `connection`, методы чтения.
2. **Массивные операции** – `bulk`, `queue`, `setNextNumber`.
3. **Управление статусом** – `issue`, `annul`, `createReady`.
4. **Работа с файлами и снимками** – `savePrintFile`, `removePrintFile`, `restore`, `editSnapshotItem`.


---
Итог раннера: задач 7/5 · 1 мин 47 с · шагов 26 · вызовов 25 · отказов 0 · токенов ответа 18096 (169 ток/с в среднем по прогону)
