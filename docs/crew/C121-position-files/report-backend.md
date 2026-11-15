# C121 backend — отчёт

## Контракт для frontend
`GET /api/incomes/:id/attachments` → `{items,total,page,limit}` (роли admin/director/manager/user). Поля item:
`id, productId, incomeId (null для файла изделия), scope: 'product'|'line', typeId, typeName (папка), originalName, size, ext, mime, uploadedAt, uploadedByName, deletedAt`. `storedPath` не отдаётся.
- `POST /api/incomes/:id/attachments?typeId=<id вида>` multipart `file` (admin, manager; director тоже — выше manager по иерархии; user → 403). Ответ — один item (201). Ошибки 400/404/507 по-русски. Позиция без изделия → 400.
- `DELETE /api/incomes/:id/attachments/:aid` — admin; только файл этой позиции.
- Скачивание: `POST /api/products/<item.productId>/attachments/<item.id>/download-ticket` → `{ticket, expiresIn:60, url}`; url `/api/products/…/file?t=` (публичный, одноразовый, Range). Папки = виды (`GET /api/dicts/attachmentTypes`); PDM — отдельно `GET /pdm-files?ownerKind=product&ownerId=<productId>`.
- Список изделия (`/products/:id/attachments`) и ZIP заказа файлы позиций не включают.

## Статус
Готово, не закоммичено. tsc 0; jest: 342/343 suites — падает `pwa-guards.spec.ts` «design-lint» (зона frontend, не мой); e2e `income-attachments.e2e-spec.ts` 6/6 зелёные на Mongo; eslint модуля чисто; циклы 0.
Файлы: `modules/productattachments/` (schema +incomeId, service, income-attachments.service.ts, income-attachment-upload.guard.ts, controller IncomeAttachmentsController, module, order-attachments.service.ts), spec `income-attachments.spec.ts`, `test/e2e/income-attachments.e2e-spec.ts`, `docs/MAP.md`.
Отклонения: openapi.json не обновлён (в нём вообще нет путей вложений, регенерация — Docker); приёмка «director POST → 403» не выполняется — director проходит как старший manager (как и у файлов изделия).
