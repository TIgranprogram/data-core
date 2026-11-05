# ВЛ-1 BE-2 — отчёт backend (2026-11-05)

Статус: готово, не закоммичено. tsc 0; jest productattachments+control+salesorders+disk: 22 набора, 200 тестов зелёные; eslint новых файлов чисто; audit-cycles без новых пар.

1. ZIP по заказу ✅ — `order-attachments.service.ts`, `order-zip.ts`, контроллеры в `productattachments.controller.ts`. `GET /salesorders/:id/attachments/summary?types=`, `POST …/zip-ticket?types=` (журнал `attachment.zip`), `GET /salesorders/:id/attachments.zip?types=&t=` (публичный по тикету). store, поток, ≤ 2 сборок (429), потолок `ATTACHMENT_ZIP_MAX_BYTES` 5 ГБ (413), нет файла → `_ПРОПУЩЕНО.txt`.
2. Диск ✅ — `GET /health/disk`: `parts.attachmentsBytes/attachmentsFiles`, `attachmentsWarning{level,text}` (warn: свободно <15 % или <10 ГБ; danger: <10 % / <5 ГБ / выше потолка).
3. Копии ✅ — `offsite.ts` через `skipAttachments` (`backups.ts`); `deploy/synology/bundle.sh` исключает `uploads/attachments`. Включить: `BACKUP_ATTACHMENTS=1`, `BUNDLE_ATTACHMENTS=1`. `backup.sh` не менялся (hardlink, места не стоит).
4. Чистка ✅ — `purgeDeleted()` в 03:xx раз в час-проверкой; убранные >14 дней: файл стирается, `fileRemovedAt`; restore такого — 400; `usedBytes` не считает стёртые.
Тесты: `order-zip.spec.ts` (имена/дубли, слоты, потолок, цепочка с фейк-базой, тикет, роли, метрики, фильтр offsite, чистка).
Нужно от frontend: строка «Вложения» из `parts` + `attachmentsWarning` в «Состоянии» (admin.js:1460); окно ZIP в заказе (summary → zip-ticket → переход по `url`).
Риски: тикет в памяти процесса; ZIP-е2е на живой базе и нагрузка не гонялись (QA); openapi.json не регенерирован (нужен Docker); `bundle.ts` eslint-ошибка `exists` прежняя. docs/MAP.md обновлён.
