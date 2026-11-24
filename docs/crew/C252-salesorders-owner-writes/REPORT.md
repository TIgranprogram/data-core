# C252 — хозяин записи salesorders

Статус: готово, без коммита. HTTP не менялся. Прод не трогался. C253 не начат. L-251 не менялся. Файлы C256 не трогались.

Сырая запись коллекции `salesorders` в рантайме — только `backend/src/modules/salesorders/salesorder-writes.ts`. Модель в `SalesOrdersService` по-прежнему создаёт, правит, уносит в корзину и возвращает договор. Юридическая правка — `patchLegal` с этой же моделью (`updateLegal`). Методы `SalesOrdersService` с `:601` — фасад тех же функций. Вторая транзакция не открывается: сессию передаёт вызывающий.

Модуль, которому импорт `salesorders` замыкает цикл, зовёт `common/salesorder-owner-port.ts`. Так устроены partners, shipments и справочник форм оплаты. `common/order-archive/write.ts` только реэкспортирует захват.

## Покрытие до перевода

Уже было: создание и гонка `11000` — `c164-source-replay-race.spec.ts`, `c164-source-create-stage.spec.ts`; правка шапки — `salesorders.service.spec.ts`; обрыв позиций при удалении заказа — `salesorders.remove.spec.ts`.

Дописано: захват архива / нет договора, частичная привязка к производству, чужой этап, тот же этап отгрузки не пишется, форма оплаты, замок и снимок архива, повтор ключа импорта — `salesorder-writes.spec.ts`. Отмена всего заказа производства не начинает запись — `production-orders.assign.spec.ts`.

## Операции

| Операция | Кто звал | Транзакция | Аудит | Повтор |
|--|--|--|--|--|
| Создание / правка шапки | `SalesOrdersService` | сессия правки; создание без своей сессии | version нет; `editedInApp` на правке | `clientUid` и ключ загрузки: та же карточка, чужой состав — 409 |
| Корзина / восстановление | `SalesOrdersService` | да, вместе с позициями | `editedInApp` на удалении | обрыв позиций не подтверждает удаление |
| Юридическая часть | `patchLegal` из `updateLegal` | сессия заказа | `legalVersion`, квитанция `clientUid` | тот же ключ и хеш — прежняя карточка; чужой хеш — 409 |
| Захват перед записью | `claimWritableOrders` | сессия вызывающего | нет: барьер `passportGuard`, не правка человека | архив — 409, нет договора — 404 |
| Привязка к производству | `assignContractsToProduction` | да | журнал `salesorder.updated` пишет заказ после успеха | занятый договор — 409, частичное число не остаётся |
| Перенос между заказами | `moveContractProduction` | да, после проверки выдач | журнал после успеха | чужой номер — 409 |
| Этап группы договоров | `advanceContractStage` | да | журнал каждого договора после успеха | чужой этап — 409; «отменён» на всю группу не пишется |
| Этап после отгрузки | `applyShipmentStage` | сессия отгрузки | нет | тот же этап не пишет строку |
| Архив: замок, закрытие, возобновление | `lockLiveOrder` / `closeOrderArchive` / `reopenOrderArchive` | сессия архива | `salesorder.archived` и `salesorder.archive.reopened` после записи | тот же `clientUid` возвращает квитанцию до записи; мёртвый договор не берётся |
| Заказчик | `renameOrderCustomers` | сессия переименования | нет отдельного журнала, как раньше | то же имя пишется тем же значением |
| Форма оплаты | `renameOrderPaymentForm` | сессию справочник не передавал и не передаёт | `editedInApp` | после переноса совпадений 0 |
| Шапка по ключу импорта | `upsertOrderByImportKey` | нет | нет | гонка `11000` возвращает первую шапку и не меняет её |

## Белый список

| Кто | Почему остаётся |
|--|--|
| `scripts/import-orders-xlsx.js` | разовый импорт вне Nest |
| `scripts/add-our-company.js` | разовая проставка компании |
| `scripts/order-archive-write.js` | разовый скрипт архива |
| `ensure-indexes.js`, `c164-source-indexes.js` | индексы, не документы |
| админка «Таблицы» | эти девять коллекций не пишет |
| kppdf | вне data-core, общий Mongo |

Чтения `salesorders` не переводились. Запись `orderreadystate` при пересчёте готовности не трогалась: это не коллекция договоров. Смысл архива C188 (фильтры, квитанция, снимок до записи) не менялся.

## Grep

До (C250): сырые `updateOne`/`updateMany`/`findOneAndUpdate` у order-archive, order-link, `common/order-archive/write`, shipments, partners, dicts; модель ещё у production-orders.

После: `collection('salesorders').updateOne|updateMany|findOneAndUpdate` в `backend/src` — только `salesorder-writes.ts`. `model.create` / `model.updateOne` договоров — только `salesorders.service.ts`. `model.findOneAndUpdate` юридической части — `patchLegal`, его для договора вызывает `updateLegal`.

## Проверки

`npx tsc --noEmit` — 0.  
`npx jest` 15 файлов (salesorders, dicts.rename/metal, shipments, partners.list) — 93/93.  
`node scripts/audit-cycles.js` — новых циклов 0, пар 0.  
eslint изменённых файлов — 0 ошибок (старые `any` в `salesorders.service.ts` были и остались).
