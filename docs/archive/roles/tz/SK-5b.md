# ТЗ SK-5b — «Кому / под что» при выдаче: позиция заказа с картинкой, сотрудник (интерфейс)

**Зачем (словами пользователя):** при выдаче выбрать «552-2» (заказ → позиция) и видеть название и картинку, а не цифры; или сотрудника; в истории и карточке заказа видно «Выдано под 552-2: материал × N».

**Роли:** frontend ☑ (skill `datacore-design`) · designer ☐ (после)

## Контракт сервера (SK-5a, готов)
- Движение `POST /api/stock/items/:id/move` и пачка `POST /api/stock/batch`: `salesOrderId?`, `salesOrderLineId?` (заказ можно не слать — сервер возьмёт из позиции), `personId?`, `issuedTo?`; возврат со сборки — `type:'in'`, `isReturn:true`, `salesOrderLineId`.
- `GET /api/salesorders/:id/lines-lookup` → `[{id, orderNo, lineNo, title, productId|null, photoId|null, qty|null}]`; «552-2» = `orderNo`-`lineNo`; картинка — превью фото по `photoId` (путь превью — как в других разделах, сверить в `ui/photos.js`).
- `GET /api/salesorders/:id` → `issuedByLine: [{salesOrderLineId, materialId, issued, returned, net, materialName, unit}]`.
- `GET /api/stock/movements` — в строке `salesOrderLineId`, `reason`, `isReturn`.

## Что сделать (критерии SK-5 — `docs/roles/tz/SKLAD.md` «Аналитика SK-2» §6; §2 — показ ссылки)
1. Общий компонент `ui/target-picker.js`: «Кому / под что» — заказ (список с поиском по номеру/заказчику) → позиции (из lines-lookup при выборе заказа, с картинкой и названием; поиск «552-2» находит позицию) / или сотрудник / или «просто выдано». Заменить текущий выбор «кому» в панели «Выдать» (`sections/stock-ops.js`, `issueToFields`/`withOrders`) — без потери текущих возможностей.
2. «Возврат со сборки»: в «Принять» — переключатель «Возврат под позицию» → тот же picker (только позиция заказа) → `isReturn:true`.
3. Журнал движений и история позиции: подпись «Выдано под 552-2 · <название>», «Возврат с 552-2», «Списано: <причина>».
4. Карточка заказа (`sections/salesorders.js`): блок «Выдано со склада» по позициям из `issuedByLine` (нетто, выдано/возвращено).
5. Выдача из чужой брони — подтверждение с названием заказа-владельца (если уже есть — сверить; нет — добавить в панели «Выдать»).
6. Запись в `docs/DESIGN.md` (§4 — компонент target-picker, §8).

## Файлы
- В рабочей копии ожидаются правки: `backend/src/modules/stock/*`, `backend/scripts/ensure-indexes.js`, `docs/openapi.json`, `docs/MAP.md`, `docs/UNIFY-SUPPLY-WAREHOUSE.md` (backend, SK-6a) — не трогать.
- читать: `docs/roles/README.md`, skill `datacore-design`, `sections/stock-ops.js`, `sections/issue.js`, `sections/movements.js`, `sections/salesorders.js`, `ui/photos.js`, `ui/combo.js`.
- менять: `backend/pwa/**` (перечисленное + новый `ui/target-picker.js`), `docs/DESIGN.md`.

## Критерии приёмки
- [ ] Выдача под позицию: в списке видны название и картинка; поиск «552-2» находит; уходит `salesOrderLineId`.
- [ ] Сотрудник без заказа и «просто выдано» проходят как раньше.
- [ ] Возврат под позицию уходит с `isReturn`; в журнале подписи видны; старые движения без полей — как раньше.
- [ ] Карточка заказа показывает выдано по позициям.
- [ ] Позиции заказа грузятся при выборе заказа, не при открытии панели.
- [ ] `--check` изменённых .js, `node backend/scripts/pwa-preload.mjs` (если новый модуль), `npx jest src/pwa-guards --silent` (из backend/).

## Нельзя
- Трогать сервер; модальные окна для ввода; терять текущие возможности панели «Выдать».
