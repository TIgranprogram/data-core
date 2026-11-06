# ПМ-1: сущности правой панели v2 (analyst, 2026-11-06)

Источники: `docs/MAP.md` (строки salesorders, incomes, supply, partners, stock, shipments, offers, production-orders), `entityType` в `pwa/sections/*.js`, каркас `ui/kit/entity-panel.js`.
Порядок связей — **оценка по цепочке заказа** (PRODUCT/C011). Журнала частоты на проде нет: пользователь утвердил порядок «по частоте, иначе алфавит» — после `dc audit` пересчитать по `auditlogs`.
Деньги в связях показывать только денежным ролям; закрытый роли раздел → карточка связи не рисуется (SK-8d, `MoneyMaskInterceptor`).
Все данные связей — из одного GET карточки сущности (одним запросом), счётчик на карточке связи = длина массива; тяжёлое (история) — по нажатию.

## 1. Заказ (договор) — `salesorders`, entityType `SalesOrder`
| Связь (порядок) | Откуда |
|--|--|
| Позиции | `GET /salesorders/:id` → `lines[]` (+`product`, `shipped/left`) |
| Оплата и деньги | `lines` + `money`; `incomes.payments` (деньговые роли) |
| Заявки снабжения | `supplyRequests[]` (по `salesOrderId`) |
| Склад: брони и выдачи | `reservations[]`, `stockMovements[]`, `issuedByLine` |
| Проектирование | `designtasks` по позициям (`/salesorders/:id/history?type=design`; список — `modules/design`) |
| Отгрузки | `GET /salesorders/:id/shipments` |
| Паспорта | `productpassports` по `incomeId`/`orderId` (`/history?type=passport`) |
| Заказчик | `customer` → `GET /partners/c:<название>` |
| КП | `salesorders.offerId/offerNo` → `GET /offers/:id` |
| Заказ производства | `productionNo` → `GET /production-orders/:key` (+`readiness`) |
Главный блок: Заказы — шапка, этап, приоритет, готовность; Деньги — оплаты, долг; Склад — брони/выдать по заказу; Отгрузка — остатки и «Отгрузить».
История: `/salesorders/:id/history` (журнал заказа и позиций, дизайн, паспорта, отгрузки, склад) — готовая; не `audit-logs`.

## 2. Изделие / позиция заказа — `incomes`, entityType `Income` (изделие каталога — `products`, `Product`)
| Связь | Откуда |
|--|--|
| Заказ | `orderId` → `salesorders` |
| Изделие каталога | `productId`/`product` {id,name,sku,photoId}; варианты `GET /showcase/:id/variants` |
| Проектирование | `designtasks` (одна задача = позиция) |
| Склад: брони и выдачи | `reservations`/`stockmovements` по `salesOrderLineId`; `issuedByLine` |
| Заявки снабжения | `supplyrequests` по `salesOrderLineId`/заказу |
| Паспорт | `productpassports.incomeId` / `GET /showcase/:id` → `passports` |
| Работа в цехе | `worktasks` (`modules/work`, `sections/work.js`) |
| Отгрузка | `shipments.remaining[incomeId]` |
| Состав и себестоимость | `GET /showcase/:id` → `composition`, `cost` |
| Оплата | `incomes.payments[]`, `paidAmount`, `debt` |
Главный блок: Заказы — фото, название/3 названия, qty, цена; Проектирование — задача и файлы; Склад — состав/бронь; Продукция — карточка изделия.
История: `audit-logs/record` (`Income`); для изделия — `Product`.

## 3. Счёт поставщика — `supplyinvoices`, entityType `SupplyInvoice`
| Связь | Откуда |
|--|--|
| Строки (заявки) | `GET /supply/invoices/:id` → `requests[]` (`unitPrice`, `lineAmount`) |
| Поставщик | `supplierId` → `GET /partners/:id` |
| Заказы | `orders` (цепочка заказ→договоры) |
| Договор поставщика | `contractId/contractNo` → `GET /supply/contracts/:id` |
| Файлы | `files[]` |
| Оплата | `paidAt`, `paymentAdjustments`; Деньги (календарь) |
| Приёмка на склад | `receive`, движения по `requests[].materialId` |
| Объединения | `mergeLog`, `mergedInto` |
Главный блок: Снабжение — строки и «Оформить/Принять/Оплатить»; Деньги — сумма, плательщик, дата оплаты.
История: `audit-logs/record` + `mergeLog`.

## 4. Заявка снабжения — `supplyrequests`, `SupplyRequest`
| Связь | Откуда |
|--|--|
| Счёт | `invoiceId` → `GET /supply/invoices/:id` |
| Позиция склада | `materialId` → `/stock/items/:id` (остаток, `ordered`) |
| Поставщик | `supplierName` → `partners` |
| Заказ / позиция | `salesOrderId`, `salesOrderLineId` |
| Каталог поставщика | `supplieritems` (цена, артикул; `/supply/catalog/items`) |
| Фото | `photos` |
Главный блок: Заявки — статус, количество, цена, шаги; Склад — «заказано/в пути». История: `Supply Request` в `audit-logs/record`.

## 5. Контрагент — `partners`, entityType `Partner` (поставщик, заказчик, наша компания)
| Связь | Откуда |
|--|--|
| Заказы | `GET /partners/:id` → `related` (заказчик) |
| Заявки и счета | `related` (поставщик); счета — `GET /supply/invoices?supplierId=` |
| Договоры поставщика | `GET /supply/contracts?supplierId=` |
| Брони и выдачи | `reservations`, `issues` (заказчик) |
| Каталог поставщика | `/supply/catalog/items?supplierId=` |
| Контакты | `organizationcontacts` |
| Деньги | долг/оплаты по `related` |
Главный блок: Контрагенты — реквизиты, контакт; Деньги — обороты. История: `Partner`.

## 6. Позиция склада — `materials`+`storageitems`, `Material`
| Связь | Откуда |
|--|--|
| Движения | `GET /stock/items/:id/history` (`total`) |
| Брони | `reservations` по названию/`materialId` (`/stock/reservations`) |
| Открытые заявки | `GET /stock/items/:id/ordered` |
| Заказы (под что выдано) | `stockmovements.salesOrderId` |
| Поставщики и цена | `ordered` + `supplieritems`, `lastPrice*` |
| Изделия, где используется | `products` состав (`composition`) — API списка нет, нужен запрос |
| Обрезки | `offcuts`, `offcutOf` |
| Фото | `/stock/items/:id/photos` |
Главный блок: Склад — остаток/бронь/свободно, «Принять/Выдать/Пересчитать». История: `Material` + движения.

## 7. Договор поставщика — `suppliercontracts`, `SupplierContract`
Связи: Счета (`GET /supply/contracts/:id` → `invoices[{id,no}]`) · Поставщик (`supplierId`) · Файлы (`fileIds`). Главный блок: Договоры — №, дата, предмет, срок, сумма. История: `SupplierContract`.
(Договор заказчика — это заказ, см. п.1: слово «договор» в двух значениях; в заголовке панели писать «Договор поставщика» / «Заказ».)

## 8. КП — `commercialoffers`, `CommercialOffer`
Связи: Заказчик (`counterpartyId`/`customer`) · Наша компания (`companyId`) · Заказ (`orderId` ← `create-order`) · Изделия (`items[].productId`) · Версии (`versions[]`) · PDF и фоны (`/offers/:id/pdf`, `bg1Id/bg2Id`). Главный блок: КП — строки, статус, условия. История: `CommercialOffer` + `versions[]`.

## 9. Задача проектирования — `designtasks`, `DesignTask`
Связи: Позиция заказа (`incomeId`) · Заказ · Изделие (`productId`, `product-requests`) · Исполнитель (`persons`) · Файлы/фото · Заявка на новое изделие (`productRequestId`) · Паспорт. Главный блок: Проектирование — статус, обсуждение, файлы. История: `DesignTask`.

## Решения и риски
- Договор заказчика = `salesorders`; «Договор» в меню Деньги/Заказы — тот же объект (не плодить вкладки, C011).
- Для связей «Паспорта» нужен `incomeId` — в схеме паспорта его нет (`product-passport.schema.ts`, аудит SHIPMENTS-PASSPORTS): связь по `orderId`/`productId`, пока не добавят.
- Нет API: «изделия, где материал используется» (п.6), список `designtasks` по заказу одним вызовом — вопрос архитектору.
- Историю для сущностей без `entityType` в журнале (`Shipment`, `Reservation`) не обещать до проверки `audit-logs/facets`.
