# ТЗ C036 Ш3 — заявки пачкой: `POST /supply/requests/bulk`

**Зачем (словами пользователя):** «Заказать одну или несколько позиций из каталога, со склада, у поставщика.»
**Зачем — глаголом:** снабженец отмечает 10 позиций галочками и одним нажатием создаёт 10 заявок, поставщик и цена подставлены сами.

## Глубже
- **Результат:** сервер умеет создать N заявок одним запросом; экраны Ш4/Ш5 будут звать только его.
- **Сырьё:** сейчас одна заявка — `POST /supply/requests` (`supply.controller.ts:356`, `supply.service.ts:434 create`); поставщик и цена из прошлых закупок — `GET /stock/items/:id/ordered` (`stock.controller.ts:306`), экран `pwa/sections/item-orders.js:78 orderItem` (поставщик: чаще и свежее — первым, его `lastPrice`).
- **Метод профи:** пачка = цикл по существующему `create()` (одни правила, номера из счётчика, уведомления), идемпотентность через `clientUid` на каждую строку.
- **Внешний судья:** юнит-тесты: пачка из 3 → 3 заявки; повтор того же `clientUid` → те же заявки, новых нет; поставщик и цена подставлены из прошлых закупок.
- **Смелая планка:** 50 позиций — один запрос, повтор после обрыва связи не плодит дубли.

**Класс:** M · **Max agents:** 1 (backend) · **Reviewers:** нет (координатор) · **Проверки:** smoke (tsc + `jest src/modules/supply`)

## Shared pack — контракт
- `POST /api/supply/requests/bulk`, роли как у `POST /supply/requests` (`admin`, `manager`), `@AuditAction` `supply.request.created` (или `.bulk`).
- Тело: `{ clientUid: string, items: [{ materialId: string, qty: number > 0, supplierId?: string }] }`, 1–200 строк. DTO с `ValidateNested` (whitelist — только эти поля).
- Для каждой строки: `create({ materialId, qty, supplierId, priceHint, clientUid: `${clientUid}:${materialId}` }, userId)` после `assertNew(...)` со scope.
  - `supplierId` не задан → взять из прошлых закупок этого материала тем же правилом, что `item-orders.js:80` (чаще, затем свежее); нет закупок → без поставщика.
  - `priceHint` = последняя цена у выбранного поставщика (из той же истории); нет — из `supplieritems` (этот поставщик + этот материал, `priceHint`); нет — пусто. Цена в заявке — снимок (ЕН-1: последняя закупка, прайс — подсказка).
  - Логику «история закупок материала» не копировать: вызвать сервис, который отвечает `items/:id/ordered`, или вынести общую функцию.
- Ответ: `{ items: [<заявка как в GET /supply/requests/:id>], total }`. Ошибка в одной строке → вся пачка 400 до записи (сначала проверить все `materialId` существуют и в scope), а не половина записана.

## Файлы
- Менять: `backend/src/modules/supply/supply.controller.ts` (рядом с :356, маршрут объявить ДО `requests/:id`), `supply.service.ts` (метод `createBulk`), `dto.ts`, новый `supply.bulk.spec.ts`; `docs/MAP.md` строка маршрута.
- Читать: перечисленные места, `stock.controller.ts:306` и его сервисный метод.
- Не трогать: `backend/pwa`, незакоммиченные чужие `docs/QUESTIONS.md`, `docs/roles/maps/frontend.md`. Не читать docs целиком, `openapi.json` целиком.

## Критерии приёмки
- [ ] 3 строки → 3 заявки с `materialId`, `qty`, поставщиком и ценой из истории (юнит).
- [ ] Повтор с тем же `clientUid` → те же id, новых нет (юнит).
- [ ] Несуществующий `materialId` → 400, ничего не записано (юнит).
- [ ] `npx tsc --noEmit` 0; `npx jest src/modules/supply --silent` зелёный.

## Нельзя
- Менять схему `supplyrequests` (общая с CRM), поведение `POST /supply/requests`.
- Коммитить, выкладывать.

## Отчёт
`REPORT-SH3.md` рядом, ≤ 10 строк.
