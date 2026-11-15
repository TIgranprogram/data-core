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

