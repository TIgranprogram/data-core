# C251 — хозяин записи incomes

Статус: готово, без коммита. HTTP не менялся. Прод не трогался. C252/C253 не начаты.

Сырая запись коллекции `incomes` в рантайме — только `backend/src/modules/incomes/income-writes.ts` и модель в `IncomesService` (создание, правка, фото, корзина позиции, идентификаторы оплат). Методы `IncomesService` с `:574` — фасад тех же функций. Вторая транзакция не открывается: сессию передаёт вызывающий.

Модуль, которому импорт `incomes` замыкает цикл, зовёт `common/income-owner-port.ts` (те же функции). Так устроены partners, showcase, product-requests, matching, выбор паспорта.

## Покрытие до перевода

Уже было в `incomes.service.spec.ts`: создание, правка, version/409, корзина и восстановление позиции, повтор `clientUid` платежа, оплата не даёт удалить позицию.

Дописано: гонка строки источника `11000` возвращает ту же позицию, другой состав — конфликт (`incomes.service.spec.ts`). Отмена / возврат / перенос и обрыв внутри транзакции — `income-cancel.service.spec.ts`. Конфликт версии отмены, кэш шапки, корзина заказа, классификация — `income-writes.spec.ts`. Обрыв позиций при удалении заказа — `salesorders.remove.spec.ts`.

## Операции

| Операция | Кто звал | Транзакция | Аудит | Повтор |
|--|--|--|--|--|
| Создание / правка позиции | `IncomesService` | сессия, если есть договор или статья | version + editedInApp; журнал модели как раньше | `clientUid` и строка источника: та же запись, чужой состав — 409 |
| Корзина / восстановление позиции | `IncomesService` | да, version | epoch паспорта | чужая version — 409, запись не тронута |
| Идентификаторы оплат | `commitPaymentIdentities` | да | `auditlogs` после удачной записи; 0 совпадений — журнал не пишется | тот же `clientUid` до записи |
| Отмена / возврат отмены | `markCancelled` / `restoreCancelledLine` | да, вместе со снятием броней | version, причина, `cancelledBy`; отдельного auditlog не было и нет | уже отменена или чужая version — 409 |
| Перенос в договор | `moveLineToOrder` | да, вместе со ссылками задач | version + epoch | чужая version — 409; пустой договор не пишется |
| Кэш шапки заказа | `syncOrderHeaderCache` | сессия правки заказа | нет: это не правка человека, version не растёт | те же поля переписываются безопасно |
| Корзина вместе с заказом | `softDeleteLinesWithOrder` / `restoreLinesDeletedWithOrder` | сессия заказа | epoch; метка `deletedWithOrder` | обрыв второй записи не подтверждает удаление |
| Подбор в договоре | `confirmOrderLineProduct` | сессия заказа | version; эпоха только при смене изделия | строка уже с изделием — 409 |
| Сопоставление | `matchIncomeLine` | сессия пачки | журнал `income.updated` пишет matching после записи | повтор ставит то же изделие |
| Заказчик | `renameCustomerLines` | сессия переименования | `editedInApp` | то же имя — без новой сути |
| Изделие из заказов | `bindDraftProduct` | сессия создания изделия | version + epoch | только заранее отобранные строки без изделия |
| Заявка на изделие | `attachIncomeNewProductRequest` / `confirmRequestLines` | сессия заявки | `editedInApp`, эпоха при смене изделия | подтверждение пишет одно изделие всем строкам заявки |
| Форма оплаты / цвет | `renameIncomeText` | сессию добавляет справочник | `updatedAt`; шапка заказа по-прежнему в salesorders | после переноса совпадений 0 |
| Эпоха паспорта | `bumpIncomePassportEpoch` | сессия паспорта | фильтр эпохи у `claimPassportLine` | чужая эпоха — `modifiedCount` 0, STALE |
| Выбор источника паспорта | `setIncomePassportSelection` | после захвата эпохи | `passport.selection.changed` пишет паспорт | mode не site/attachment — 400, строка не пишется |
| Классификация оплаты | `applyIncomeClassification` | сессия денег | `finance.classification.updated` после успеха | чужая version документа — 409, журнал не пишется |

## Белый список

| Кто | Почему остаётся |
|--|--|
| `scripts/import-orders-xlsx.js` | разовый импорт вне Nest, план/сессия скрипта |
| `scripts/incomes-payments-migrate.js` | разовый перенос оплат |
| `scripts/add-our-company.js` | разовая проставка компании |
| `scripts/archive/match-legacy-exact.js` | архивный скрипт |
| `ensure-indexes.js`, `c164-source-indexes.js` | индексы, не документы |
| админка «Таблицы» | эти девять коллекций не пишет |
| kppdf | вне data-core, общий Mongo |

Чтения `incomes` не переводились. Записи `reservations` / `supplyrequests` при переносе позиции не трогались: это не коллекция доходов.

## Grep

До (C250): сырые `updateOne`/`updateMany` у salesorders, matching, partners, showcase, product-requests, dicts, line-source, passport-source, financial-classification, income-cancel; модель ещё у income-payment-identities.

После: `collection('incomes').updateOne|updateMany` в `backend/src` — только `income-writes.ts`. `model.updateOne` / `model.create` доходов — только `incomes.service.ts`.

## Проверки

`npx tsc --noEmit` — 0.  
`npx jest` 11 файлов (incomes, salesorders, matching, dicts.rename/metal, line-source, partners.merge) — 144/144.  
`node scripts/audit-cycles.js` — новых циклов 0. Из снимка C256 убраны 6 циклов: matching и паспорта больше не импортируют incomes.  
`node --test scripts/audit-cycles.test.mjs` — 6/6.
