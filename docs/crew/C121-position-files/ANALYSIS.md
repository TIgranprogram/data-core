# C121 — анализ (analyst, 15.11)

## 1. Папки во «Вложениях» позиции
Позиция заказа = `incomes` с `productId`.
- **Фото позиции** — `incomes.photoIds` (`income.schema.ts:87`), зона `photoDrop`. Грузят admin, manager.
- **Папки изделия** (справочник `attachmentTypes`: Чертежи, Паспорта, Договоры/КП, 3D) — `productattachments` по `productId`, `GET /products/:id/attachments`. Видят admin/director/manager/user; грузят admin, manager (`productattachments.controller.ts:36-37`); удаляет admin. Общие для всех заказов изделия.
- **PDM** — `GET /pdm-files?ownerKind=product&ownerId=<productId>`, только чтение.
- **Паспорт позиции** (`productpassports.incomeId`) — в «Документы», не во «Вложения».

## 2. Сервер (вариант А, по умолчанию)
- Необязательное поле `incomeId` в `productattachments` (коллекция не общая с CRM).
- `POST /incomes/:id/attachments?typeId=` (multipart `file`): `productId` из позиции; admin, manager; лимиты прежние (`ATTACHMENT_MAX_BYTES`, `attachment-capacity.ts`, `attachment-formats.ts`, Throttle 60/мин).
- `GET /incomes/:id/attachments` → `{items,total,page,limit}`: файлы изделия + файлы позиции, флаг `scope: 'product'|'line'`; без `storedPath`; четыре роли.
- Скачивание — существующий `download-ticket` (60 с, одноразовый).

## 3. Drag-out / drop-in
- Drag-out: `dragstart` → `setData('DownloadURL', 'mime:имя:абсолютный_url')` — только Chrome/Edge десктоп. Тикет берётся заранее (`pointerenter` / открытие папки); нет тикета — плитка не draggable, есть «Скачать». URL с префиксом `PREFIX` (`product-attachments.js:57`), в имени без двоеточия.
- Firefox/Safari/телефон — только «Скачать».
- Drop-in: `dragover` + класс `k-over` (как `product-attachments.js:130`) → POST по файлу с `typeId` папки; «Фото» — `photoDrop`. PDM и роль user drop не принимают. Ошибки — `toastError`.

## 4. Приёмка
**Backend:** manager POST PDF → 201, файл виден в своей позиции, не виден в другой позиции того же изделия; user/director POST → 403, GET → 200; превышение лимита / чужой формат → 4xx по-русски, без записи; позиция без `productId` → 400; удаление admin — файлы изделия остаются; нет `storedPath`; e2e (загрузка, список, изоляция, права, удаление); `openapi.json`, `MAP.md`.
**Frontend:** светло-жёлтые папки с числом файлов, пустая — подсказка; drag на рабочий стол даёт файл (дважды подряд); drop на папку — файл появляется без перезагрузки; user зон загрузки не видит; «Скачать» везде; PDM только чтение; таблицу и шапку заказа не трогать; эталон `folderTile` в kit и `#kit`; снимки 1700 / 390.

## Вопросы владельцу (работа идёт по умолчанию)
1. Файлы одной позиции (скан приёмки, фото монтажа) нужны? По умолчанию — да.
2. Кто грузит в позицию? По умолчанию — admin и manager, удаляет admin.
3. Папка PDM — только чтение? По умолчанию — да.
4. Паспорт позиции — в «Документы»? По умолчанию — да.
