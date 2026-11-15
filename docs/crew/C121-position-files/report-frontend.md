# C121 frontend

Готово: kit folderTile (ui/kit/folder-tile.js, CSS в kit.css, витрина #kit, DESIGN §4); карточка «Вложения» (sections/order-line-files.js, подключена в order-line-more.js:36). Папки = виды вложений; drag-out DownloadURL (тикет на pointerenter), «Скачать» в каждой строке, drop-in файла на папку (admin/manager; user зон не видит). Нет сервера (404) — папки изделия.

Не сделано: «Состав» (заготовка), photoDrop «Фото» (photoIds), кнопка «Загрузить» для телефона/Firefox (только перетаскивание), снимки 1700/390, PDM-папка.

Проверки: syntax-check файлов ok; dc check — всё ок, кроме tsc: income-attachments.service.ts(40,108) TS2339 (backend). design-lint 0.
