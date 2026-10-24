# ТЗ SK-5a — выдача под позицию заказа и сотруднику, причина списания, возврат (сервер)

**Зачем (словами пользователя):** выдать материал под «552-2» (заказ-позиция) или сотруднику; видеть, что под какую позицию ушло; списание — с причиной; возврат со сборки — приходом.

**Роли:** backend ☑ · qa ☐ (после) · frontend — SK-5b (после)

## Что сделать (решение архитектора — `docs/roles/tz/SKLAD.md` §8, критерии — «Аналитика SK-2» §6 SK-5; решения СК-4, СК-7, СК-8 — `docs/QUESTIONS.md`)
1. `stock/stock-target.ts` — `resolveTarget({salesOrderId, salesOrderLineId, personId, issuedTo})`: заказ существует и не в корзине; позиция (`incomes`) принадлежит заказу; только позиция — заказ берёт сервер из позиции; сотрудник существует; ошибки по-русски (400). Использовать в одиночном движении, пачке (`batch()` — вынести оттуда текущую логику, без дубля), выдаче по брони.
2. `StockMoveDto` (+ `StockBatchDto` где нужно): `salesOrderId?`, `salesOrderLineId?` (@IsOptional @IsMongoId), `reason?` (@IsOptional @IsString @Length(0,100)), `isReturn?` (@IsOptional @IsBoolean).
3. Причина списания: `stockmovements.reason?: string` (необязательное поле схемы, без enum). Справочник «Причины списания» в dicts (брак, потеря, порча, прочее; правят manager+, как другие справочники). Списание (выдача без заказа и без сотрудника, тип — как в коде принято для списания; сверить) без причины → 400 «Укажите причину списания»; причина не из справочника → 400.
4. Возврат: `stockmovements.isReturn?: boolean` — только у прихода и только с `salesOrderLineId` (иначе 400).
5. `GET /api/salesorders/:id/lines-lookup` → `[{id, orderNo, lineNo, title, productId, photoId, qty}]`: photoId — первое фото позиции, иначе фото изделия, иначе null; без цен; права как у чтения заказов.
6. «Выдано под позицию» для карточки заказа: нетто по позиции = Σвыдач − Σвозвратов, без отменённых (`cancelledAt`, `cancelOf`) — функция + в ответ карточки заказа или отдельный маршрут (выбери простое, опиши в отчёте).
7. Юнит: resolveTarget (все ошибки), причина списания, возврат, нетто с возвратом и отменой. openapi (вручную, как в SK-4a), MAP, `docs/UNIFY-SUPPLY-WAREHOUSE.md` — «поля только data-core: reason, isReturn».

## Файлы
- В рабочей копии ожидаются правки: `backend/pwa/ui/facet-filter.js`, `backend/pwa/ui/base.css`, `docs/DESIGN.md` (frontend, SK-1) — не трогать.
- читать: `docs/roles/README.md`, SKLAD §8, `backend/src/modules/stock/*`, `salesorders/*`, `dicts/*`, `income*.schema.ts`.
- менять: `backend/src/modules/stock/*` (новый `stock-target.ts`), `salesorders/*`, `dicts/*`, `docs/openapi.json`, `docs/MAP.md`, `docs/UNIFY-SUPPLY-WAREHOUSE.md`.

## Критерии приёмки
- [ ] Выдача с позицией без заказа — заказ подставлен сервером; чужая позиция для заказа → 400.
- [ ] Старые клиенты (без новых полей) работают как раньше; старые движения без полей читаются.
- [ ] Списание без причины → 400 с русским текстом; с причиной из справочника — проходит.
- [ ] Возврат без позиции → 400; нетто считает возвраты и не считает отменённое.
- [ ] lines-lookup без цен, с photoId по правилу.
- [ ] `npx tsc --noEmit` = 0; `npx jest src/modules/stock src/modules/salesorders src/modules/dicts` зелёные.

## Нельзя
- Менять `type` движения (enum общий с CRM), обязательность полей общих коллекций; данные прода; новые коллекции.
