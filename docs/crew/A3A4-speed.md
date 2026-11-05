# A3/A4 — скорость GET /api/stock/items и /api/supply/requests

Причина (по коду, замеров на проде нет): N+1 нет; тяжёлого $lookup нет. Потери — последовательные чтения и повтор запроса.
- stock/items: расчёт строк кэшируется по версиям 5 коллекций (в т.ч. `supplyrequests`), любая правка заявки сбрасывает кэш → холодный расчёт (materials целиком + storageitems + заявки + обрезки ≈ 1,3 с). После него фото и «висящая» бронь читались последовательно.
- supply/requests: `materials` читалась дважды (названия + фото), «свои» фото заявок — после остальных чтений.

Изменено:
- backend/src/modules/stock/stock-search.service.ts:84-90 — `photoMap` и `hangingQtyByMaterial` через Promise.all.
- backend/src/modules/supply/supply.service.ts:120-128 — `materialPhotos` → `materialInfo` (один запрос materials: имя + фото); :147-156 — все чтения present() в одном Promise.all (−1 запрос к materials, −1 последовательный шаг).
Формат ответов и контракт не менялись. tsc 0, jest stock+supply: 22 набора / 300 тестов зелёные.

Предложить (не применено, прод не трогал):
- `supplyrequests`: индекс `{materialId:1, status:1, deletedAt:1}` (openRequests — `$in` по 278 id).
- `photos`: индекс `{parentPhotoId:1, variant:1}` (поиск превью).
- `reservations`: `{materialId:1, status:1, deletedAt:1}`.
- `materials`: `{offcutOf:1, deletedAt:1}`.
(Проверить через `getIndexes()`, часть может быть.)

Не сделано:
- Холодный кэш stock: ограничить `materials.find` проекцией полей (много полей читается, риск) и не сбрасывать кэш от `supplyrequests` — нужно решение, отдельная задача.
- supply: `countDocuments` + `find` + 2 aggregate (aggregate уже в кэше по версии). Замерить `explain` на проде.
