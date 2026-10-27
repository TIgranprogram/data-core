# Аудит скорости 2026-10-28 (architect, без данных прода)
Прод в момент проверки отвечал 502 (nginx), замеры живых фото не сняты.
1. backend/src/main.ts:111 — /uploads без Cache-Control/maxAge (имена файлов с id): каждое фото ревалидируется. Добавить maxAge 30d, immutable.
2. photos: нет индекса parentPhotoId (photo.schema.ts:45); запрос миниатюр common/photos.ts:11, stock-search.service.ts:40 идёт по индексу variant (все thumb). Добавить index({parentPhotoId:1,variant:1}), внести в ensure-indexes.js (Photo уже в MODELS), прогнать после выкладки.
3. photos: thumb || url — у фото без миниатюры в список уходит оригинал (до 2560 px / 3 МБ): common/photos.ts:14, pwa products.js:28,260, board.js:139, list.js:469. Бэкфилл tz-photo-303-backfill-thumbs.ts (план -> --apply) + проверить, что у каждого photos original есть thumb.
4. stock-search.service.ts:228 categorySummary — listItems({limit:100000}) строит все позиции с фото; кэш есть, но холодный вызов тяжёлый. Считать счётчики по rows до пагинации.
5. today.service.ts: параллельно, LIMIT 300, проекции, индексы designnotes есть; stockCounts берёт весь кэш склада (ok). Узких мест нет. Для designtasks/supplyrequests/salesorders status+deletedAt агрегаты — проверить индексы status.
6. pwa: 117 modulepreload в index.html (стартовая волна), screens.css 102 КБ, products.js 48 КБ, list.js 45 КБ. HTTP/2 у nginx терпимо, но лучше preload только ядра, остальное по разделу.
7. sw.js:59 /uploads cache-first — норм; PHOTOS не чистится по размеру (проверить квоту).
8. lazy: loading=lazy есть почти везде; нет decoding=async, нет width/height (сдвиги). card.js:38 (strip) и design-stickers.js:85, photos.js:78 — без lazy.
