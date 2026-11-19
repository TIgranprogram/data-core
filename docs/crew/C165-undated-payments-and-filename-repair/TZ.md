# C165 — оплата подтверждена без даты и восстановление имени PDF

19.11.2026, прямое уточнение владельца после C158/C162 v1.951: завести известные счета с неизвестной датой оплаты и пометкой заполнить дату. Обычный draft сейчас возвращается в долг через legacyrequests, поэтому одной note недостаточно. Сопутствующая реальная помеха C157:CLIпередал CP1251имя PDF, физические байты/SHA целы; исправляется существующая запись, без второго PhotoDoc/загрузки.

Класс XL: деньги/источники/права, дополнение C158, не переделка ledger. Бизнес и Principalсовет обязательны: `../C158-supply-financial-fields/UNDATED-PAYMENT-RULES.md`, `UNDATED-PAYMENT-ARCH.md`. Sourcebase f76489b9/runtimeb809fed4, соседний C163-паспорт будет включён ДО финального общего QA, один согласованный выпуск. Код C163/его стенд не трогать.

## Владение и контракт реализации

Backend: только backend/src/modules/{supply,finance,photos}, точечные commonmoney-mask/typehelpers если действительно нужны, backend/test/e2e и относящиеся unit; shared supplyrequestsschema НЕ менять. Frontend координатор/роль только backend/pwa финансовые состояния. QA рабочий код не правит. Документы задачи/карта роли обязательны, без коммитов/деплоя исполнителями. Ты не один в репозитории, чужие правки не отменять.

### 1. Отдельное подтверждение без даты

SupplyInvoice.optional undatedPaymentEvidence без legacydefault/массовоймиграции. Pending/resolved/revoked, UID/hash, фиксированные известные RUBсумма/плательщик/состав и классификация строк, основание/файлы, автор/время, исходная версия. Это НЕ денежный факт. Повторные/предыдущие команды не должны заново активировать уже resolved/revoked подтверждение; сохранять достаточные receipts/history, чтобы иной payloadUID409, а одинаковый повтор не создавал повторных изменений.

`POST /api/supply/invoices/:id/undated-payment` typed `{clientUid,version,reason,fileIds?}`; `POST .../undated-payment/revoke` typed `{clientUid,version,reason}`. Денежные роли как payments, wholeinvoice/scope/видимость, транзакция+общий invoiceCAS+аудит. Reason>=3, UID<=100, fileIDs<=20существующих. Сумма/плательщик/строки только из согласованного счёта, не произвольного тела. Только полная RUBсумма/известнаянашаКомпания, без любых ledgerfact(включаяvoided), paid/snapshot/paidзеркал/legacyконфликта. Draft валидированно переводится issued, без paid. Received/stock не изменяются и сами по себе не являются отказом финансовой отметки.

Публичное wholeinvoice derived `paymentState:'date_required'`, `requiresPaymentDate:true`, `undatedConfirmedAmountRub`; paidAmount/sourcePaidAmount/sourceBalance/balanceDue=null, а исходная сумма/цены известны. Partial/scoped/noMoney полностью маскируют raw evidence/сумму/состав/основание, не раскрывать через spreadinv. Статус draft/issued/paid/cancelled не подменять paid; в заявках paid/paidAt не выставлять.

Finance.managedRequestInvoices подавляет pendinglegacyстроки глобально ДО периода/компании; invoiceObligations исключает долг/просрочку/повторный прогноз. Никакого marker1/нулевого/voidпсевдоплатежа. В canonicaloperations/cashflow нет операции без даты. needsFill дополнить ОТДЕЛЬНОЙ группой needsPaymentDate `{items,total}` с invoiceId/sourceLink/причиной, не притворяться requestId старого expenseформата. Доступ/компания/scope как у документов, не выгружать весь скрытый счёт.

### 2. Уточнение даты и блокировки

Обычный C158 `POST /payments` принимает явную существующую date<=today, только полную confirmedсумму, тотжеpayer и состав/классификацию; ledgerfact + resolution evidence/paymentId + synchronize в ОДНОЙ транзакции/CAS. Ранняя проверка paymentUID перед staleversion/pendingstate сохраняется. Replay/lostresponse/две даты одновременно — один факт или409. Состояние confirmation/history сохраняется для аудита, не пропадает без следа.

Старый `/pay`/payRemaining, который ставит today, приpending409; unpay/void не снимают evidence, только revokeсreason. Финансовая основа/состав/аналитические распределения pending фиксируются; header/line/add/remove/merge/directrequest/import/batch альтернативы должны блокироваться В DBусловииCAS, не только preGET. Правка возможна после мотивированного revoke. Приёмка/receiptBoundary/stock независимы; обычные старые счёта/оплаты не меняют поведение. Pendinghistoricalarticle snapshot при archive/rename/reparent не превращается молча в другую статью/null при filldate.

### 3. UI (после READY backend)

Invoicecard/list/board: warning «Оплата подтверждена — заполнить дату», отдельная confirmedundatedсумма/основание, ссылка «Заполнить дату» в общую форму с фиксированными суммой/плательщиком. Не показывать «Оплатить сегодня»/unpay. Фильтр `needsPaymentDate=1` в списке инвойсов и группа в «Требуют заполнения». Сначала сохранение confirmation, reopen, затем явный ввод даты. Source№24334/16.09/50076/3строки/22%9030.09/СИЮ/Геленджик. Дата неизвестна, сообщение08:41—день не угадывать.

### 4. Исправление имени существующего PDF

`POST /api/photos/:id/repair-original-filename`, classDTO `{expectedOriginalFilename,newOriginalFilename}`, manager/admin + аудит. Ограниченная длина, без control/путей. Atomic compareexpected+deletedAt:null; alreadynew→no-op, другоеcurrent409, произвольныйrename400. Разрешены только точные преобразования rawlatin1→валидныйUTF8 либо windows1251 через TextDecoder, результат должен совпасть с заданным новым именем. Общий decoder не менять CPэвристикой: корректные западные имена должны сохраниться. Никаких storageUrl/mime/size/variants/filebytesизменений, второгоPhotoDoc/reupload/DELETE.

Реальный24479:Photo6aff3d721eb87438515b41eb,265700байт,SHA c709dfbfdb347a0954bdbe7d086b0bf622a8db8bc751e2682def11f2d353eb64, invoice6aff3d6e1eb87438515b41d8/8строк. Первичный STOP был до оплаты; затем тот же журнал безопасно завершён, сейчас paid31960,14₽/balance0/DONE. Повторять импорт/платёж нельзя. Имя `Ñ÷åò íà îïëàòó ¹ 24479 îò 17.09.2026.pdf` должно стать `Счет на оплату № 24479 от 17.09.2026.pdf`. До общего выпуска backend никто не правит этот файл на prod. CLI следующих multipart уже проверен локальным UTF8-тестом и применён к7077/63.

## Проверки/приёмка

Backend: tsc/moduleunit/eslint; e2e pending не попадает в факт/долг/прогноз в разных месяцах/компаниях; pendingнеутекаетpartial/noMoney; confirm/revoke/edit/payment race и forcedrollback; legacy/partial/FX/mismatchreject; old/pay409; датаfill ровно один ordinaryfact/UIDretry; receiving не создаётся/не откатывается. PhotoCAS/knownencodings/alreadyproper/replay/refusalarbitrary/no path or bytes mutation; originaldecoderwesternрегрессия.

UI: actualownedcopy, обе desktopтемы, invoicecard/listfilter/needsfill/reopen/полная дата и warning, потом датаfill и один факт; сравнение сумм/дат/компании/UID до/после. QA+адресныйarchitect+designer, максимум2цикла. Финальный fullunit/e2e иPWA на ОБЪЕДИНЁННОМ сC163 коде, OpenAPI/MAP/data-model/atlas/help/TEST-LOG. Проверка продуктов/паспортов C163 — их владелец, не переделывать их scope.

Backendотчёт BACKEND-REPORT.md: точныефайлы/контракты/команды/результаты/риски; сообщить READYзафиксированныйAPIдоfrontend. Никакихprodwrites/секретов/коммитов. После выпуска accessвосстанавливает filename существующегоID, затем продолжает тотжеC157журнал без дублей; неизвестный24334 импортируется только с рабочимpendingсостоянием.
