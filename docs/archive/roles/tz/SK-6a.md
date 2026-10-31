# ТЗ SK-6a — бронь под позицию заказа и спецификация из Excel (сервер)

**Зачем (словами пользователя):** бронировать материал под конкретную позицию заказа; загрузить спецификацию (Excel) — по ней сразу брони; «выдать по заказу» одной кнопкой.

**Роли:** backend ☑ · qa ☐ (после) · frontend — SK-6b (после)

## Что сделать (решение — `docs/roles/tz/SKLAD.md` §8; сценарии — «Аналитика SK-2» §3, §5, критерии §6 SK-6; решения СК-5, СК-6, СК-9 — `docs/QUESTIONS.md`)
1. `reservations.salesOrderLineId?: ObjectId` (необязательное, ссылка на `incomes`; `orderItemIndex` CRM не трогать). Бронь с позицией — через `resolveTarget` (`stock/stock-target.ts`, уже есть). Индекс `{salesOrderId:1}` sparse в схеме + строка в `backend/scripts/ensure-indexes.js` (запуск на проде — координатор).
2. Правка брони (PATCH: количество, позиция заказа, примечание) — если маршрута нет; права как у создания брони.
3. «Выдать по заказу»: список активных броней заказа + выдача всех/выбранных одной операцией (пачка, общий batchId, `clientUid` от повтора); выдача по брони с позицией пишет `salesOrderLineId` в движение.
4. «Висящие» брони (СК-6): у брони признак «заказ отгружен или аннулирован» в списке броней/остатков (вычисляемый, не поле в БД); снимает человек.
5. Спецификация (файл разбирает клиент): `POST /api/stock/spec/preview` — строки `[{code?, name, qty, unit?, salesOrderLineId?}]` (≤500) + `salesOrderId` → сопоставление с позициями склада (одна функция, нормализация `article-clean.ts`, один запрос `$in`, без N+1): `matched / notMatched / short` (не хватает свободного — СК-9), ничего не пишет. `POST /api/stock/spec/apply` — подтверждённые строки → брони (общий `batchId`, `groupName` «Спецификация <дата>»), `replace: true` — снять активные брони прежней загрузки этого заказа (`groupName` начинается со «Спецификация»); строки с нехваткой пропускаются и возвращаются в отчёте; повтор — `clientUid`. Новый файл `stock/stock-spec.service.ts`.
6. Цены в ответах — только canSeeMoney (MoneyMask). Юнит: сопоставление, нехватка, replace, повтор. openapi (вручную), MAP, `docs/UNIFY-SUPPLY-WAREHOUSE.md` (поле `reservations.salesOrderLineId` — только data-core).

## Файлы
- В рабочей копии ожидаются правки: `backend/pwa/**`, `docs/DESIGN.md` (frontend, SK-4b) — не трогать.
- читать: `docs/roles/README.md`, SKLAD §8, `backend/src/modules/stock/*` (особенно `stock-reservations.service.ts`, `stock-target.ts`), `backend/src/common/article-clean.ts` (или где он), `backend/scripts/ensure-indexes.js`.
- менять: `backend/src/modules/stock/*`, `backend/scripts/ensure-indexes.js`, `docs/openapi.json`, `docs/MAP.md`, `docs/UNIFY-SUPPLY-WAREHOUSE.md`.

## Критерии приёмки
- [ ] Бронь с позицией без заказа — заказ подставлен; чужая позиция → 400; старые брони и клиенты работают как раньше.
- [ ] preview ничего не пишет; apply создаёт брони одной пачкой; повтор с тем же clientUid не создаёт дублей; replace снимает прежнюю загрузку.
- [ ] Нехватка: строка пропущена и есть в отчёте.
- [ ] «Выдать по заказу» выдаёт брони одной операцией, отмена пачки возвращает остаток.
- [ ] `npx tsc --noEmit` = 0; `npx jest src/modules/stock` зелёный; файлы сервисов < 500 строк.

## Нельзя
- Обязательность/enum полей общих коллекций; данные прода; запуск ensure-indexes на проде.
