# T3 — Скорость

**Охват:** индексы (`ensure-indexes.js`, схема `@Prop(index/unique)`), тяжёлые запросы без индексов, N+1 в сервисах (`finance`, `partners`, `today`, `zone-events`, `matching`), пагинация, кэш (`DataVersionService.cached`), первый экран (`main.js`, `today.service.ts counters`). Код не правил, замеров в браузере не делал (нет стенда) — оценки по коду.

## Находки

| № | Где | Сценарий «что случится» | Совет | Важн. |
|--|--|--|--|--|
| 1 | `scripts/ensure-indexes.js:16-34` | В prod `autoIndex:false`, индексы создаёт только этот скрипт по списку `MODELS`. Списка нет у ~20 моделей: `User`, `Role`, `Organization`, `Category`, `Counterparty`, `WorkType`, `Unit`, `Currency`, `ColorReference`, `ProductModule`, `AttributeDefinition`, `EntityAttributeValue`, `Status`, `Site`, `DesktopPairingKey`, `DeviceInvite`/`BrowserDeviceGrant`, `Permission`, `Setting`, `FeatureFlag`, `RateLimit`, `IdempotencyStorage`, `ExpenseArticle`, `CommercialOffer`, `OfferBackground`, `MaterialRequest`, `PassportTemplate`. Любой индекс/уникальность, добавленный в эти схемы после выключения autoIndex, на проде не создаётся: `organizations.inn` (unique), `users.username` (unique), `role.name` (unique) → дубли и сканы. | Тест: каждый `*.schema.ts` с `index/unique` есть в `MODELS`/`RAW`; список формировать из модулей автоматически. | 🟡 |
| 2 | `today.service.ts:104-120` | `activeProductionCount` грузит **все** `salesorders` (`find({stage:{$nin:['cancelled']}}).toArray()`) и считает в JS — на каждую отрисовку меню (`/me/counters`) и после каждого изменения данных. Много заказов → полное чтение коллекции каждый раз. | Свести к `aggregate([{$group:...}])` или держать число в кэше по версии `salesorders`. | 🟡 |
| 3 | `finance.service.ts:244-254` | Прогноз/календарь читает целиком неоплаченные `supplyrequests`, `incomes` и `organizations.find({})` (без фильтра) в память; составные фильтры `status+paid+companyId+deletedAt` без составных индексов. Раздел — admin/директор, только чтение, но при росте данных тяжелеет. | Составной индекс на частые фильтры финансов; `organizations` — с `deletedAt:null` и проекцией. | 🟡 |
| 4 | `partners.service.ts:142` | Карточка контрагента грузит до `limit(3000)` заявок без пагинации («сгруппированы по месяцам»). Контрагент с тысячами заявок — большой ответ и DOM. | Пагинация/подгрузка по месяцам или агрегация на сервере. | 🟡 |
| 5 | `today.service.ts:94` (`paidAmount:{$not:{$gt:0}}`) | `countDocuments` с отрицательным оператором не использует индекс — сканирует `incomes` на каждой отрисовке меню. | Переписать условие на индексируемое (`paidAmount: null`/`$lte:0`) + индекс. | 🟢 |
| 6 | `DataVersionService.cached` (склад, паспорта, fill-audit); `products{deletedAt,name}` в RAW; `main.js:408-417` | Позитив: тяжёлые списки кэшируются по версиям коллекций; разделы грузятся лениво (`loadSec`); первый экран = `/auth/me` + `/me/counters` + `/today` (оболочка — в service worker). Явных N+1 не нашёл: сервисы читают пакетно (`$in`) и `Promise.all`. | Не трогать; кэш расширять по мере роста данных. | 🟢 |

## Топ-3 и порядок исправления

1. 🟡 №1 — закрыть полноту списка `MODELS` (страховка, что индексы и уникальность доезжают до прода).
2. 🟡 №2 — `activeProductionCount` через агрегацию/кэш (дешёво, снимает постоянное чтение `salesorders`).
3. 🟡 №3 — составные индексы под финансовые фильтры.

## Сомнения

- Замеры «вживую» (туннель ~1 с, 1 ядро на VM) по коду не видны: нужны `GET /health/…`-подобные замеры или `SlowRequestInterceptor` (A4) с порогом — проверить, что медленные запросы реально логируются и читаются.
- `ui/kit/list.js` — проверял косвенно (CANON «Без моргания», `list.update()` приращивает, не перерисовывает весь экран); замера реального времени перерисовки большого списка (100 строк) не делал.
