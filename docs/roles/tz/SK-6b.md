# ТЗ SK-6b — брони под позицию, правка брони, «Выдать по заказу», спецификация из Excel (интерфейс)

**Зачем (словами пользователя):** забронировать под позицию заказа, поправить бронь, выдать всё по заказу одной кнопкой; загрузить спецификацию Excel — по ней сразу брони; видеть «висящие» брони.

**Роли:** frontend ☑ (skill `datacore-design`) · designer ☐ (после)

## Контракт сервера (SK-6a, готов — полностью в отчёте, кратко)
- Бронь под позицию: `POST /stock/reserve-list` + `salesOrderLineId?`; одиночная — `POST /stock/items/:id/move` `type:'reserve'` + `salesOrderId?`/`salesOrderLineId?`.
- `PATCH /stock/reservations/:id` `{qty?, salesOrderId?: string|null, salesOrderLineId?: string|null, note?}` → `{id, qty, salesOrderId, salesOrderLineId, notes}`; больше свободного → 400 с текстом.
- `GET /stock/reservations/order/:salesOrderId` → `{order{id,label,customer,stage}, hanging, items[{id, materialId, name, unit, qty, issued, onHand, canIssue, groupName, batchId, salesOrderLineId, lineNo, lineTitle}], total}`.
- `POST /stock/reservations/issue-order` `{salesOrderId, reservationIds?, personId?, issuedTo?, note?, clientUid?}` → как `reservations/issue` (+ `batchId`); 409 — часть уже выдана.
- `POST /stock/spec/preview` `{salesOrderId, lines:[{code?, name, qty, unit?, salesOrderLineId?}]}` (≤500) → `{matched[], short[] (+shortBy), notMatched[{row, reason: notFound|ambiguous|unit|badLine|badQty, message, candidates?}], previous[{batchId, groupName, createdAt, count}], counts}`.
- `POST /stock/spec/apply` `{salesOrderId, lines:[{row?, materialId, qty, salesOrderLineId?, note?}], replace?, takeFree?, clientUid?}` → `{repeated, batchId, groupName, created, replaced, reserved[], skipped[]}`.
- Висящие: `GET /stock/reservations` — `hanging` у группы и строки; `GET /stock/items` — `hangingQty`.

## Что сделать (сценарии — `docs/roles/tz/SKLAD.md` «Аналитика SK-2» §3.3–3.5, §5, критерии §6 SK-6; решения СК-5, СК-6, СК-9)
1. «Забронировать» (панель `stock-ops.js`): под заказ → позиция — через `ui/target-picker.js` (режим «под заказ»); бронь уходит с `salesOrderLineId`.
2. Список броней (`sections/reservations.js`): правка брони в правой панели (количество, заказ/позиция, примечание); метка «висящая» (текст причины) + действие «Снять»; в «Остатках» — подсветка `hangingQty`.
3. Карточка заказа (`sections/salesorders.js`): блок «Брони заказа» (из `reservations/order/:id`) + кнопка «Выдать по заказу» (все / выбранные галочками) → `issue-order` с `clientUid`; отмена — через существующую отмену пачки.
4. Спецификация: в карточке заказа «Загрузить спецификацию» → правая панель: файл xlsx (разбор на клиенте `core/xlsx-read.js`; колонки по SKLAD §5; кнопка «Скачать шаблон» — собрать xlsx на клиенте тем же способом, что выгрузки в Excel) → preview → таблица «найдено / не хватает / не найдено» (для `ambiguous` — выбор из `candidates`) → «Забронировать» (`apply`); если есть `previous` — выбор «Заменить прежнюю / Добавить / Отмена»; после — отчёт `reserved`/`skipped`, кнопка «Забронировать сколько свободно» (повтор с `takeFree:true`). Новый `ui/spec-import.js`.
5. Замечания дизайнера по SK-5b — координатор пришлёт отдельным сообщением; исправить в этом же ТЗ.
6. DESIGN §4/§8.

## Файлы
- В рабочей копии ожидаются правки: нет (сервер готов).
- читать: `docs/roles/README.md`, skill `datacore-design`, `docs/roles/frontend.md` (уроки), `sections/stock-ops.js`, `reservations.js`, `salesorders.js`, `ui/target-picker.js`, `core/xlsx-read.js`, `ui/list-export.js`.
- менять: `backend/pwa/**`, `docs/DESIGN.md`.

## Критерии приёмки
- [ ] Бронь под позицию создаётся и видна в карточке заказа; правка брони — в правой панели; ошибки сервера показываются текстом.
- [ ] «Выдать по заказу» — одной операцией, повторное нажатие не дублирует.
- [ ] Спецификация: шаблон скачивается; preview показывает три группы; ambiguous выбирается; apply бронирует; replace/добавить работает; нехватка — в отчёте и «сколько свободно».
- [ ] Висящие брони помечены, снимает человек.
- [ ] `--check` изменённых .js, `pwa-preload.mjs` (новые модули), `npx jest src/pwa-guards --silent`.

## Нельзя
- Трогать сервер; модальные окна для ввода; отправлять файл на сервер.
