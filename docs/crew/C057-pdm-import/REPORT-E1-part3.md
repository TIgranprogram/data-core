# C057-Э1 часть 3 — «Что купить» и скачивание приложения (отчёт исполнителя, перенесён координатором)

**Статус:** готово. `docs/openapi.json` не перегенерирован (нужен Mongo: `docker compose exec backend node dist/src/export-openapi.js`) — перед выкладкой.

## Сделано
1. ✅ `GET /api/products/:id/purchase-needs?qty=1` (admin, director, manager, user). Обход — существующий `CatalogGraphService.getTree`. Ответ `{items:[{materialId,name,kind,unit,need,have,buy,buyUnit,format?,note?}], missingBlank:[{id,article,name}]}`.
   - Сортамент: нужно = Σ × `scrapFactor`; есть = Σ `stockQty` × размер формата (м² / м); купить = ceil((нужно − есть) / размер основного формата) шт. Нет формата → в м²/м + «Нет формата на складе — покупка в м²».
   - Метизы/покупные: шт. Деталь без сырья → `missingBlank`. `qty` ≤ 0 / не число / > 1e6 → 400.
2. ✅ `modules/apps`: `GET /api/apps/pdm-loader`, `GET /api/apps/pdm-loader/download` (admin). Файл — `uploads/apps/pdm-loader/<версия>/DataCore.PdmLoader.exe` (+ `meta.json`); старшая версия по `^\d+\.\d+\.\d+$`; нет — 404 «Приложение ещё не выложено». Загрузки через API нет.
3. ✅ Тесты: `purchase-needs.spec.ts` (8), `apps.service.spec.ts` (5), e2e `pdm-import` + 4 сценария → 18/18 (лист 4 мм 0,060744 м², фанера 0,48 м², шайба 8 шт; формат 1250×2500 с остатком 1: qty=100 → 1 лист, qty=200 → 3).

## Находки сверх ТЗ (исправлены)
- `GET /api/apps/pdm-loader/download` перехватывал `AppDataModule` (`apps/:app/:collection`) → 400. `AppsModule` поставлен в `app.module.ts` раньше.
- `uploads/apps/*` отдавался бы статикой **без входа**. `isAttachmentsUrl` расширен до `attachments|apps` (`productattachments/attachment-paths.ts`) → `/uploads/apps/*` = 404.

## Проверки
tsc 0 · jest product/app-data/catalog/apps/productattachments — 771/771 · e2e pdm-import 18/18 · audit-cycles 0 · eslint 0.

## Риски
- Выкладка должна класть exe в `uploads/apps/pdm-loader/<версия>/` — отдельный пункт (чек-лист 26).
- Э3: экран «Что купить» читает `items` и `missingBlank`.
