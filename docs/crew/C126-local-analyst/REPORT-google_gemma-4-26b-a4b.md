# C126 — отчёт модели google/gemma-4-26b-a4b (домашний ПК, 2026-11-15 21:15)

## Задача 1 — методы без проверки ролей
Проверено: 9 методов
Находки:
- backend/src/modules/attribute-definition/attribute-definition.controller.ts:21 @Get() — список определений атрибутов — да — низкая
- backend/src/modules/attribute-definition/attribute-definition.controller.ts:26 @Get(':id') — конкретный атрибут — да — низкая
- backend/src/modules/auth/auth.controller.ts:120 @Get('me') — данные текущего пользователя — да — низкая
- backend/src/modules/entity-attribute-value/entity-attribute-value.controller.ts:45 @Get(':entityType/:entityId/attributes') — значения атрибутов сущности — да — средняя
- backend/src/modules/meta/meta.controller.ts:33 @Get('schema') — схема метаданных — да — низкая
- backend/src/modules/meta/meta.controller.ts:42 @Get('openapi.json') — документация API — да — низкая
- backend/src/modules/meta/meta.controller.ts:50 @Get('guide') — руководство по метаданным — да — низкая
- backend/src/modules/showcase/showcase.controller.ts:174 @Get(':id/variants') — варианты витрины — да — низкая
- backend/src/modules/user/user.controller.ts:42 @Get(':id') — профиль пользователя — да — средняя (проверить, нельзя ли увидеть чужой профиль)
Не уверен: проверка прав на просмотр конкретных ID в user и entity-attribute-value.

## Задача 2 — модули без описания в docs/MAP.md
Проверено: 11 модулей
Находки:
- ColorReferenceModule (color-references) — управление справочниками цветов
- DataVersionModule — версионирование данных
- DeviceEnrollmentModule (device, admin/devices) — регистрация устройств
- DictionaryLabelModule (dictionary-labels) — метки словарей
- FillAuditModule (fill-audit) — аудит заполнения полей
- LoggerModule — логирование системы
- MyTasksModule (my-tasks) — пользовательские задачи
- PermissionsBootModule — инициализация прав доступа
- RateLimitModule (rate-limits) — ограничение частоты запросов
- RoleCounterpartyModule (counterparty-roles) — роли контрагентов
- RoleOrgModule (org-roles) — роли организаций
Не уверен: для модулей без папки указано '?' в сканере.

## Задача 3 — переменные окружения без описания в .env.example
Проверено: 42 переменные
Находки:
- Секреты (высокая важность): BACKUP_SECRET_KEY, DEVICE_GRANT_SECRET_BYTES, DEVICE_INVITE_SECRET_BYTES, OFFSITE_SMB_AUTH_DIR, SENTRY_DSN.
- Остальные: 
  * control/switch: APP_VERSION, HA_AUTO_REFRESH_MIN, HA_PEER_URL, HA_SELF, HA_SWITCH_DIR, PWA_VERSION_FILE
  * desktop: DESKTOP_DOWNLOAD_URL, DESKTOP_MIN_VERSION, DESKTOP_RECOMMENDED_VERSION
  * config/configuration: DEVICE_COOKIE_NAME, DEVICE_ENROLL_BASE_URL, DEVICE_GRANT_TTL_DAYS, DEVICE_INVITE_TTL_DAYS, DEVICE_JWT_TTL_SECONDS, DEVICE_OWNER_INVITE_TTL_MINUTES, JWT_REFRESH_TOKEN_TTL
  * common/middleware: BOOT_RELAX_PERMISSIONS, DISABLE_THROTTLE, TRUST_PROXY
  * common/guards: DISABLE_THROTTLE, TRUST_PROXY
  * main: CORS_ORIGINS, HTTP_REQUEST_TIMEOUT_MS, SENTRY_DSN
  * disk/bundle/offsite: HOST_BUNDLES_DIR, HOST_REQUESTS_DIR, OFFSITE_SMB, OFFTSITE_SMB_AUTH_DIR, UPLOAD_DIR
  * ... (и другие сгруппированные по модулям)
Не уверен: проверка полноты списка всех используемых в коде констант.

## Задача 4 — проглоченные ошибки в приложении
Проверено: 3 файла (наибольшее число .catch)
Находки:
- backend/pwa/sw.js:
  - line 58, 59, 71, 72: cleanup() и fill() — нормально (фоновая очистка кэша/метаданных).
  - line 138: fetch(req) — нормально (запрос метаданных).
- backend/pwa/sections/request-fill.js:
  - line 50, 51, 52, 125: api() запросы к ценам и каталогу — нормально (просто не отобразим данные, если нет связи).
  - line 146: ordersLookup() — нормально (поиск в локальном индексе).
- backend/pwa/sections/orders.js:
  - line 51: api('/showcase') — нормально (загрузка вариантов).
  - line 88: обработка события — нормально.
  - line 279: api(`/salesorders/${row.orderId}`) — ПРЯЧЕТ ОШИБКУ (если не загрузится статус заказа, пользователь может ошибочно подумать, что заказ можно редактировать/заблокирован).
  - line 294: lookups() — нормально (загрузка справочников).
Не уверен: в `request-fill.js` на строке 125 ошибка загрузки каталога не приведет к потере данных, но может скрыть наличие товаров.

## Задача 5 — самые большие файлы
Проверено: 4 файла (> 800 строк)
Находки:
- backend/src/modules/product-passport/product-passport.service.ts (954 строки). Содержит логику выпуска, аннулирования, работы с очередями и снимками данных паспорта продукции. Рекомендуется разделить на: 1) Core operations (issue, annul, restore); 2) Snapshot & Revision management; 3) Queue & Numbering logic.
- backend/src/modules/dicts/dicts.defs.ts (930 строк). По результатам сканера пуст или не удалось прочитать структуру через scan.sh. Проверить наличие определений.
- backend/src/modules/supply/supply.service.ts (826 строк). Управление поставками, фото, инвойсами и стоком. Рекомендуется разделить на: 1) Photo & Attachment management; 2) Supply lifecycle (create, receive, rollback); 3) Lookup & Search logic.
- backend/src/modules/supply/supply-invoice.service.ts (818 строк). Работа с инвойсами поставок, объединение и обновление строк. Рекомендуется разделить на: 1) Invoice creation & receiving; 2) Merge & Update logic; 3) Payment & Line management.
Не уверен: содержание dicts.defs.ts из-за пустого вывода сканера.


---
Итог раннера: задач 5/5 · 1 мин 57 с · шагов 23 · вызовов 23 · отказов 1 · токенов ответа 3222 (28 ток/с в среднем по прогону)
