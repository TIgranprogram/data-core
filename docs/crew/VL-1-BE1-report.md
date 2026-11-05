# ВЛ-1 BE-1 — отчёт backend (2026-11-05)

Статус: готово, не закоммичено. tsc 0; jest `productattachments` + `dicts` + `common` + `database` зелёные (spec: 25 проверок модуля); eslint чисто.

Сделано
- Модуль `modules/productattachments/`, коллекция `productattachments` (`products` не менялась). Индексы `{productId,typeId,deletedAt}`, `{typeId}`; `ProductAttachment` в `scripts/ensure-indexes.js`.
- Справочник «Виды вложений» (`attachmentTypes`, simpleList + «Порядок», «Допустимые форматы»); занятый вид не удалить, объединение переносит файлы. Сид 4 видов при первом старте, если справочник пуст.
- Загрузка `POST /products/:id/attachments?typeId=` (поле `file`): multer diskStorage потоком, имя на диске uuid+расширение, белый список из TASKS (без GIF), сигнатуры по таблице отчёта (EXE/ELF/#!/скрипт — отказ для всех; SLDPRT/SLDASM — только запрет исполняемых), недопустимый файл стирается, 400 по-русски. Лимит `ATTACHMENT_MAX_BYTES`, по умолчанию 512 МБ.
- Guard до приёма тела: изделие и вид существуют, место (ВЛ-В5 по умолчанию: потолок min(50 ГБ, 70 %), запас 1 ГБ, иначе 507).
- Права: загрузка admin+manager; список и тикет — admin, director, manager, user; удаление и restore — только admin. Журнал `attachment.created/deleted/restored`.
- Скачивание: `POST …/:aid/download-ticket` (60 с, один раз) → `GET …/:aid/file?t=` (@Public, поток, Range, attachment, nosniff, CSP sandbox). Чужой/удалённый id — 404.
- `main.ts`: `/uploads/attachments` отдаёт 404 (учтены %61, `..`, `//`, регистр, `\`); `server.requestTimeout` = 1 ч (`HTTP_REQUEST_TIMEOUT_MS`).
- Прочее: текст 413 в `multer-exception.filter.ts` без «5 МБ»; openapi.json и MAP.md обновлены.

Риски / нужно от других
- openapi правлен скриптом вручную (регенерация нужна Docker+Mongo).
- Тикет в памяти процесса: на двух серверах HA тикет действует там, где выдан. Докачка по Range требует нового тикета (тикет гасится на первый запрос).
- Проверку «512 МБ без роста памяти» и nginx (16m, буферизация, таймауты) — QA на стенде / действие админа. e2e не писался (QA).
- `audit-cycles`: 1 пара `incomes <-> product-requests` — прежняя, не из этой работы.
- Сигнатуры SLDPRT/3D нужно сверить на реальных образцах пользователя.
- Для BE-2: `usedBytes()` в сервисе уже считает размер (включая убранные); ночная чистка использует `deletedAt`.
