# FIX-TZ — аудит «Продукция / КП» (дополнение C018)

**Источник:** `REPORT.md` §«Продукция / КП» · **Класс:** L · **Область:** offers, salesorders, showcase import/from-orders, kp.js, offers.js, PRODUCT.md

## Чек-лист

| # | Файл / раздел | Проблема | Действие |
|---|---------------|----------|----------|
| 1 | `offers.controller.ts`, `offers.service.ts`, `dto.ts` | Нет заказа из КП | `POST /offers/:id/to-order` (черновик), `POST /offers/:id/create-order` (шапка + incomes без цен, `orderId` на КП), идемпотентность |
| 2 | `sales-order.schema.ts`, `salesorders.service.ts` | Нет обратной связи | Поля `offerId`, `offerNo`; заполнять при create-order |
| 3 | `offers.js` | Нет кнопки после «Принято» | «Сделать заказ» / «Открыть заказ»; подсказка при оплаченном без заказа |
| 4 | `kp.js` | `colors[]`/`sizes[]` не попадают в корзину | `kpAdd` + поля в форме корзины |
| 5 | `kp.js` | Корзина только localStorage | Подсказка в форме корзины |
| 6 | `offer.schema.ts`, `offers.service.ts` | После sent правка без версии | `versions[]`, снимок перед PATCH при sent/accepted |
| 7 | `showcase.service.ts` import + from-orders | Массовое создание без дедупа | `findSimilar` — точное совпадение имени → не создавать, привязать/обновить; в preview — `similar` |
| 8 | `PRODUCT.md` §«Не делаем» | КП устарело | Актуализировать § КП и список «не делаем» |
| 9 | `docs/TEST-LOG.md`, `offer-pdf.spec.ts` | PDF не принят | Прогон unit PDF-layout; строка приёмки |
| 10 | `docs/MAP.md`, `docs/openapi.json` | Контракт | Новые маршруты offers + поля salesorders |

**Не в scope:** этап 3 редактор макета КП, импорт CRM quotations, перенос корзины на сервер.

## Статус выполнения (2026-11-03)

| # | Статус |
|---|--------|
| 1 | ✅ API to-order / create-order |
| 2 | ✅ offerId/offerNo на заказе |
| 3 | ✅ UI «Сделать заказ» |
| 4 | ✅ корзина: colors[]/sizes[], поля |
| 5 | ✅ подсказка localStorage |
| 6 | ✅ versions[] при PATCH sent/accepted |
| 7 | ✅ dedup import + from-orders |
| 8 | ✅ PRODUCT.md §5б |
| 9 | ✅ TEST-LOG + offer-pdf unit |
| 10 | ✅ MAP.md |
