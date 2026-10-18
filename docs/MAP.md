# MAP — карта кода (модуль → маршруты → коллекции)

> Все пути относительно `backend/src/`. Маршруты — под префиксом `/api`. Точные контракты: grep по `docs/openapi.json`.
> Типовой модуль: `modules/<m>/{<m>.module,.controller,.service,.schema}.ts` + `dto/` + `*.spec.ts`. Открывай только нужный файл.

## Платформенное ядро

| Модуль | Маршруты | Коллекции | Заметки |
|--|--|--|--|
| `auth` | `/auth/login` `refresh` `logout` `me` `register`(→410) | — | JWT access 15м; refresh через strategy `jwt-refresh`; login-softlock в `common/login-softlock` |
| `user` | `/users`, `/users/:id`, `/users/me/profile`, `change-password` | `users` | `refreshTokenVersion` инвалидирует refresh-токены |
| `role` | `/roles` | `roles` | системные роли admin/manager/user (сид) |
| `permissions` | — (сервис) | `permissions` | каталог прав: `common/seed/permissions.constants.ts` |
| `admin` | `/admin/users` `/admin/roles` `/admin/permissions` `/admin/collections[/:name]` | — | бэкенд админки; `collections-admin.controller.ts` = реестр всех коллекций (`COLLECTIONS`, `kind`: `core` / `link` / `crm` — таблицы CRM kppdf на общей базе, не удаляются / `app` — `app_*`, единственное, что можно удалить из админки) |
| `desktop` | `/desktop/pairing-keys` (выдать/список/revoke), `/desktop/pairing`, `/desktop/compat` | `desktop_pairing_keys` | **машинные ключи `kppd_`**; проверка ключа — `desktop-pairing-key.service.ts` `authenticateBearer`; scope ключа (P2) — `common/guards/key-scope.ts` |
| `device-enrollment` | `/device/*`, `/admin/devices/*` | `browserdevicegrants`, `deviceinvites` | привязка браузеров по cookie `__Host-kppdf-device` |
| `audit` | `/audit-logs` | `auditlogs` | пишется `AuditInterceptor` + `@AuditAction` |
| `setting` | `/settings`, `/settings/:key`, `catalog-appearance` | `settings` | сид `settings.seed.ts` |
| `feature-flag` | `/feature-flags` | `featureflags` | |
| `rate-limit` | `/rate-limits` | `rate_limit_entries` | просмотр/сброс блокировок |
| `status` | `/statuses/:entityType`, `/workflows/:entityType` | `entitystatuses`, `statusworkflows` | |
| `counter` | — (только сервис `CounterService`, без HTTP) | `counters` | атомарная нумерация |
| `dictionary-label` | `/dictionary-labels` | `dictionary_labels` | подписи справочников |
| `photos` | `/photos`, `/photos/upload`, `/photos/:id/frame` | `photos` | sharp-превью; файлы в `uploads/` → `/uploads/*` |
| `app-data` | `/apps`, `/apps/:app/:collection`, `/apps/:app/:collection/:id` (GET/POST/PATCH/PUT/DELETE) | `app_<app>_<collection>` (создаются на лету) | **P1**: CRUD JSON-документов любого приложения без кода на сервере; сырые коллекции через Connection, служебные поля и soft-delete ставит сервис; валидация имён/filter/sort — `app-data.validation.ts`; scope ключа по приложениям — `app-scope.guard.ts`; парсер тела 16 МБ — `app-data.body-parser.ts` (подключён в `main.ts` и e2e-харнессе); права `app-data:read/write/admin`; модуль стоит в `app.module` до EAV (коллизия маршрута `/:entityType/:entityId/attributes`) |
| `meta` | `/meta/schema`, `/meta/openapi.json`, `/meta/guide` | — | самоописание API для клиентов и ИИ: таблицы/поля из моделей (без секретов), контракт OpenAPI (из `main.ts` → `MetaService`), markdown-инструкция `meta-guide.ts`. Любой ключ, в т.ч. read |

## Канонические справочники

| Модуль | Маршруты | Коллекции | Заметки |
|--|--|--|--|
| `organization` (+`contacts/`) | `/organizations`, `/organizations/current`, `/organizations/:id/assets/:role`, `/organizations/:orgId/contacts` | `organizations`, `organizationcontacts` | мульти-орг: `organizationId` во многих сущностях |
| `counterparty` | `/counterparties`, `/counterparties/quick` | `counterparties` | ИНН-валидатор `common/validators/inn.validator.ts` |
| `person` | `/persons` | `persons` | |
| `site` | `/sites`, `/sites/ensure-default` | `sites` | площадки контрагента |
| `role-org` / `role-counterparty` | `/org-roles`, `/counterparty-roles` | `orgroles`, `counterpartyroles` | сиды |
| `category` | `/categories`, `tree`, `reorder`, `reorder-children` | `categories` | дерево |
| `unit` / `currency` | `/units`, `/currencies` (по `:key`), `active` | `units`, `currencies` | сиды; валюта всегда RUB |
| `color-reference` | `/color-references` | `color_references` | RAL; сид «Не выбран» |
| `work-type` | `/work-types`, `where-used` | `worktypes` | нужен product/product-module (populate) |
| `material` | `/materials`, `composition`, `tree`, `where-used`, `duplicate` | `materials` | создание требует `name`, `article`, `unit` |
| `product` | `/products`, `bulk`, `composition`, `tree`, `where-used`, `duplicate`, `:productId/modules` | `products` | EAV-атрибуты, состав (composition-lines) |
| `product-module` | `/modules`, `bulk`, `composition`, `tree`, `where-used` | `productmodules` | |
| `product-photo` / `product-module-photo` | `/products/:productId/photos`, `/product-module-photos` | `productphotos`, `productmodulephotos` | |
| `product-passport` | `/passports`, `/products/:productId/passport` | `productpassports` | |
| `attribute-definition` | `/attribute-definitions` | `attributedefinitions` | EAV: определения |
| `entity-attribute-value` | `/:entityType/:entityId/attributes[/:attributeId]` | `entityattributevalues` | EAV: значения; логика в `common/eav/eav.service.ts` |

**Вспомогательные (без контроллеров):** `catalog` — composition-line (DTO/схема/сервис состава), `catalog-references.ts` — защита удаления «используется в составе» (products/productmodules), `catalog-graph` — обход дерева состава / where-used (используют material, product, product-module, work-type), `document-render` — утилиты форматирования.

## common/ и прочее

| Путь | Что |
|--|--|
| `common/guards/` | `jwt-auth.guard` (JWT **или** `kppd_` из `Authorization: Bearer`/`X-Access-Token`), `permissions.guard`, `roles.guard`, `throttler-behind-auth.guard`, `last-admin`/`owner-*` guards |
| `common/decorators/` | `@Public` `@Roles` `@Permissions` `@CurrentUser` `@AuditAction` `@IsObjectId` |
| `common/filters/` | `http-exception` (CastError→400), `multer-exception` (413/400), `version-conflict` (optimistic lock) |
| `common/interceptors/` | `user-context`, `audit`, `id-normalize` (глобальные) |
| `common/seed/` | сиды на старте (`OnApplicationBootstrap`): admin, permissions, roles, settings, statuses, units, categories, currencies, colors, org/counterparty roles |
| `common/idempotency/` | `Idempotency-Key` middleware + хранилище |
| `common/mongoose/optimistic-lock.plugin.ts` | версия документа → 409 при конфликте |
| `database/` | `database.module.ts` (подключение + глобальные плагины `soft-delete`, `audit`, `user-context`) |
| `config/` | `configuration.ts` (env → конфиг), `env.validation.ts` (Joi), `secret-validation.service.ts` (в prod падает при слабых секретах) |
| `health.controller.ts` | `/health`, `/health/ready`, `/health/live` (публичные) |
| `swagger.config.ts`, `export-openapi.ts` | Swagger UI `/docs` (не в prod) и экспорт `openapi.json` |
| `../admin/` | админка: `index.html`, `admin.js` (вся логика), `admin.css` |

## Таблицы CRM kppdf

В базе `datacore` живут и коллекции CRM kppdf (заказы, КП, склад, производство, документы…): модулей в data-core для них нет, пишет kppdf (`D:\kppdf-8.0`). В реестре — `kind:'crm'`. Проверки удаления справочников учитывают ссылки из них (`modules/catalog/catalog-references.ts` → `isUsedByCrm`).
