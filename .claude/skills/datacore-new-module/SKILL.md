---
name: datacore-new-module
description: Как добавить новую сущность/модуль (коллекцию + CRUD API) в data-core по канону проекта — схема, DTO, сервис, контроллер, права, регистрация, реестр коллекций, доки. Использовать, когда пользователь просит «добавить таблицу/справочник/сущность/эндпоинт».
---

# Новый модуль data-core

Образец для копирования — небольшой справочник: `backend/src/modules/work-type/` или `color-reference/` (схема + dto + service + controller + module + spec). Не изобретай структуру — повторяй образец.

## Решить до кода
- Это **общий справочник** (канонический) или **данные одного приложения**? Данные приложений — в свой префикс коллекции `app_<имя>_*` (VISION принцип #4).
- Нужен ли `organizationId` (мульти-орг) — у справочников обычно да, смотри образец.

## Шаги
1. `modules/<m>/<m>.schema.ts` — `@Schema({ timestamps: true, collection: '<имя>' })`, явное имя коллекции. Soft-delete/audit плагины подключаются глобально — `deletedAt` не изобретай.
2. `dto/create-<m>.dto.ts`, `dto/update-<m>.dto.ts` (`PartialType`) — class-validator на каждое поле (ValidationPipe режет неизвестные поля → 400). Swagger: `@ApiProperty`.
3. `<m>.service.ts` — списки возвращают `{ items, total, page, limit }`; findOne по невалидному/удалённому id → 404; удаление — через soft-delete; проверки «где используется» — только по **действующим** коллекциям.
4. `<m>.controller.ts` — `@Controller('<plural>')`, `@ApiTags`, на запись `@Permissions('<m>:write')` (и/или `@Roles('admin','manager')`), на чтение `<m>:read`; `@AuditAction` на мутации; ObjectId-параметры — `@IsObjectId`/pipe как в образце.
5. Права: добавить ключи в `common/seed/permissions.constants.ts` (иначе `PermissionsBootValidator` ругается на старте) и, если нужно, роли в сиде ролей.
6. `<m>.module.ts` → импорт в `app.module.ts` в нужную секцию (ядро / справочники).
7. Реестр коллекций админки: запись в `COLLECTIONS` в `modules/admin/collections-admin.controller.ts` (категория, русское описание, `kind:'core'` или `'link'`) — иначе таблица попадёт в «Не классифицировано».
8. Тесты: `<m>.service.spec.ts` (по образцу); для нового публичного контракта — e2e в `test/e2e/`.
9. Проверка — skill `datacore-verify`; доки — skill `datacore-docs-sync` (MAP, data-model, openapi).

## Не делать
- Не писать в Mongo в обход Mongoose-моделей (кроме read-only отчётов админки).
- Не добавлять `@Public()` на данные.
- Не тащить код из удалённого CRM-домена kppdf.
