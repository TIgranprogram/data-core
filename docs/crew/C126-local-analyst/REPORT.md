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

