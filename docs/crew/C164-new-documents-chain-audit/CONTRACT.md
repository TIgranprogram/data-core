# C164 — shared contract реализации

20.11.2026. Архитектурное решение до кода; основа daacc7bc. Это не PASS реализации/разрешение данных. Источники и бизнес-решения — TZ-NEXT, FIELD-MAPPING, QUESTIONS-SOURCE. Код/API/данные не изменены.

## 1. Владелец истины и границы

Существующий `SalesOrder` остаётся договором, `Income.orderId` — его строками, `CommercialOffer` — КП. `productionNo` — группировка нескольких договоров; новую сущность договора/денежного факта не создавать. Клиентские счета — типизированные документальные записи в комплекте договора, без второго набора Income/дохода. В первой версии допустим embedded legal bundle: новый модуль CRUD и параллельный CustomerContract не нужны.

Исходники сохраняются отдельно от каталога и от вычисленного состояния. Копии реквизитов/налога/условий являются снимком источника. Не добавлять schema default для новых legal-полей на legacy: отсутствие означает старую семантику, не импортированный черновик. Числа денег хранить конечными >=0 с точностью2, при сверках использовать целые копейки. Не менять глобальную ставку компании.

## 2. Новые поля SalesOrder

- `productionAssignment?: 'unassigned'|'new'|'existing'` — только write DTO, не в модели; отсутствие сохраняет прежний create. `unassigned` запрещает непустой productionNo, не резервирует счётчик и не создаёт производственных действий; `existing` требует существующую действующую группу; `new` использует штатный генератор. Для этих3комплектов всегда unassigned. PATCH существующих/assign остаются совместимы.
- `counterpartyId?: ObjectId` — Organization клиента, проверка deletedAt:null; `customer` остаётся отображаемой строкой. companyId проверяется как наша компания.
- `legal?: LegalBundle`, `legalVersion?: number` — отдельная версия полного legal bundle, начальная0. Обычный PATCH не принимает и не перезаписывает эти поля. `legal` хранится на текущей шапке, доступен только в подробной карточке.
- `intakeUid?: string(1..100)`, `intakeKey?: string(64hex)`, `intakeHash?: string(64hex)` — новые sparseunique индексы только для новых явно переданных значений, не использовать старый неуникальный clientUid для гарантии. Старый importKey не переопределять.

### LegalBundle (общий typed DTO/subschema SalesOrder/Offer)

```
{
 state: 'draft'|'verified',
 sourceNumber?: string(<=100), sourceDate?: 'YYYY-MM-DD',
 currency: string(/^[A-Z]{3}$/),
 gross?: number, vatMode?: 'included'|'excluded'|'none', vatRate?: number(0..100), vatAmount?: number,
 companySnapshot?: PartySnapshot, counterpartySnapshot?: PartySnapshot,
 objectAddress?: string(<=1000)|null,
 signature: {state:'unknown'|'seller_only'|'both'|'not_applicable',signedDate?:date|null,evidenceDocumentUid?:string},
 paymentVerification:'unknown'|'confirmed',
 documents: LegalDocument[0..30],
 issues: ReviewIssue[0..50],
 paymentPlan: PaymentStage[0..20],
 deliveryTerms?: string(<=4000), deadlineTerms?: string(<=4000),
 origin?: {kind:'source_import'|'manual', sourceBatchUid?:string(<=100)}
}
```

`PartySnapshot={name:string(<=500),inn?:10|12digits,kpp?:9digits,address?:string(<=1000)}`. ИНН строкой с начальными нулями. Снимок не обновляется вслед за Organization; FK и снимок не взаимозаменяемы.

`LegalDocument={uid:string(1..100),kind:'contract'|'customer_invoice'|'offer'|'specification'|'addendum'|'payment_evidence'|'acceptance', number?:string(<=100),date?:date,revision:string(<=50),fileId:ObjectId,sourceSha256:64hex, gross?:number,vatRate?:number,vatAmount?:number,currency?:3letters, supersedesUid?:string,reason?:string(<=1000),lineRefs?:string[<=300]}`. Автор/at выставляет сервер. UID,sourceSHA,fileID зафиксированы после привязки; новая редакция — append с supersedesUid, не замена оригинала. fileId действующий, проверенный PhotoDoc; тот же storageUrl не клонировать. kind invoice не запускает оплату. Исходная дата/номер отличаются от импортного номера/createdAt.

`ReviewIssue={uid:string(1..100),field:allowlisted key,label:string(<=200),reason:string(<=1000),state:'unknown'|'conflict'|'not_applicable'|'resolved',documentUid?:string,responsibleId?:PersonID,resolution?:string(<=1000)}`. Сервер ставит resolvedAt/by при переходе; resolved без заполнения/причины отклоняется. field только из поддержанных полей, не произвольный dot-path Mongo. Для явно пустого поля null, а не текст/0; not_applicable — осмысленное решение, unknown — отсутствие знания. UI показывает label, не машинный field. Поля подписи/платежей неизвестны: ни «не подписан», ни «не оплачен» автоматически.

`PaymentStage={uid,label,percent?:number(0..100),amount?:number,currency:3letters,event:'signed'|'advance_received'|'installation_completed'|'acceptance'|'fixed',offsetDays?:int(0..3650),dayType?:'calendar'|'business',dueDate?:date|null,eventDate?:date|null,evidenceDocumentUid?:string}`. Процент/сумма сверяются с source gross, сумма этапов100%; план не payments[]. Дата от события вычисляется только с подтверждённым событием, бизнес-дни требуют настроенного календаря; если календаря нет — пометка, не подсчёт по понедельник–пятница вместо праздников. Сохранить договорный текст, при конфликте дедлайнов не выбирать автоматически.

`state:draft` допускает пустые реквизиты/адрес/подписи/группу, но companyId/source businesskey/источник и корректные переданные значения обязательны. verified — явное подтверждение менеджера с проверкой блокирующих issues; не юридическая двусторонняя подпись. Выполнение/производство и legal readiness отдельны.

## 3. Маршруты SalesOrder и строки

Старые маршруты/ответы не ломаются. Добавить:

- `POST /api/salesorders` расширить указанными productionAssignment/counterpartyId/intakeUid/initialLegal; initialLegal optional только для нового сценария. Create первоначального bundle атомарно со шапкой. Новый source-import требует sourceDate/sourceNumber/companySnapshot/counterpartySnapshot(INN)/основной contractSHA; номер договора в orderNo, не contractNo(госконтракт).
- `PATCH /api/salesorders/:id/legal` `{version:int>=0,clientUid:string,reason:string(3..1000),legal:LegalBundle}` → `{id,legalVersion,legal,readiness}`. Первая запись с version0 допускает отсутствие legacy-version; CAS и journalreceipt atomically; replay sameUID/samehash возвращает тот же результат, differenthash409. Не удалять источники/history через fullreplacement: сопоставить documentsпоUID, старые должны остаться; разрешены новые ревизии, известные значения/issue update с аудитом. paymentVerification не означает сумму или дату денег.
- `GET /api/salesorders?unassigned=1&needsReview=1` независимые опциональные фильтры; list сохраняет `{items,total,page,limit}`. Только summary `legalSummary:{state,openIssueCount,unmatchedCount,documentCount}`, никакого sourcePDF/versions/длинныхissues в списке. limit<=100, сортировка + createdAt/_id.
- Подробный `GET /api/salesorders/:id` расширяется `legal,legalVersion,readiness:{openIssueCount,unmatchedCount,productionAssigned}`. Штатный production-orders/unassigned/assign переиспользовать; несколько contracts в одной productionNo сохраняют старыеIDs/lines/legal links. Защита CAS на assignment: не присваивать поздно изменённый договор молча.

`IncomeDto` расширить `matchingMode?:'manual'` и `sourceLine?:{documentUid,rowKey:string(<=100),title:string(<=1000),qty:number,unit?:string,unitPrice?:number,lineAmount?:number,description?:string(<=4000),dimensions?:string(<=1000),sku?:string(<=100)}`. SourceLine — typedimmutable snapshot, rowKey уникален внутри одного contract/document. `matchingMode:'manual'` сохраняется как признак источника, подавляет productByTitle, maybeAutoDesign и new_product attach на CREATE и ordinaryUPDATE/поздней привязке группы. Для услуг без serviceId допустима свободная sourceстрока с `matchStatus:none`, без new_product и безservicecatalogфикции. Ручное matching отдельным существующим match-products apply либо явныйproductId+confirmed; меняет только связь/статус/кто/когда, не title/цены/sourceLine и не запускает проектирование. Старые строки без matchingMode работают как прежде.

Создание19строк идёт штатным POST/incomes с orderId и новыми sourceLine/matchingMode; новая уникальность `(orderId,sourceLine.documentUid,sourceLine.rowKey)` partial только sourceстрок. UID/source businesskey конфликт даёт существующийID только при том же hash. Если общий intake не транзакционный, каждый шаг independentlyидемпотентен, шапка остаётся draft до проверки19строк/сумм и файлов; никакого скрытого полного удаления при ошибке последней строки.

## 4. КП: сохраняем CommercialOffer, исходную дату и9строк

Существующий `/offers/intake` = AIразбор текста(C092), НЕ переименовывать/не использовать для записи источника. Расширить POST/PATCH `/api/offers` существующие DTO/semantics:

- existing `date` получает source17.11; servercreatedAt отдельно. `sourceNumber?:string|null` позволяет сохранить отсутствие печатного номера, внутренний numberКП сохраняется штатным.
- новые `legal?:LegalBundle`, `legalVersion?:number`, `intakeUid/intakeKey/intakeHash` какSalesOrder; записьLegal через `PATCH /api/offers/:id/legal` с тем же envelope/CAS/receipts и readonlyhistory. ОбычныйPATCH не стираетlegal.
- `OfferItem` получает стабильный `sourceRowKey`, typed `sourceLine`(тежеисходные поля), `scopeState:'included'|'excluded'`, `exclusionReason?:string`, `exclusionConfirmedAt?:date`, `exclusionEventDate?:date|null`, `matchStatus?:'unmatched'|'confirmed'|'none'`. Нет defaultнаlegacy; отсутствиеscopeState=included. productIdoptional, никакогоcatalogcreate.
-9строкКП сохраняются, строка6excluded, ownerconfirmation20.11, событиевычёркиваниядатанеизвестна. `sourceTotal:3131000` immutable(вlegal.gross); существующийtotal остаётся исходным полнымсоставом дляисторическогоКП, новый `agreedTotal` derivedизincluded=2061000. Эти поля подписаны вUI «Исходная сумма»/«Согласовано». Дляlegacyбезисключений total==agreedTotal; genericfinanceofferне считаетобязательства.
- `linkedOrderId?:ObjectId`/existing orderId использовать **existing orderId**, связь к45безcreateOrder и без автоматическогоaccepted/paid. Новое действие `POST /api/offers/:id/link-order` `{orderId,version,clientUid}` разрешает existingcontract после сверкиcompany/counterparty/строк+agreedTotal; state/sourceнетрогать. Историческая связьКП→договор не означает платежа или принятия всегокП.
- Существующий `POST /offers/:id/create-order` при новых legal/sourceполяx переносит counterpart/source/VAT/terms и толькоincludedстроки; явноеunassigneddefaultдляновогоlegalсценария, legacydefaultсохранён. Не разрешать этотroute обходить ручную sourceстроку/создаватькаталог. Переиспользоватьобщийtransferhelper, а не второй алгоритм.
- версииКП должны фиксироваться при любом legal/source/scopeизменении, включаяdraft(существующееправилотолькопослеsentнедостаточно); версияserverat/by/reason, sourceoriginalнеудаляется.

## 5. Деньги и доступ

Реальные Income.payments остаются текущими фактами; НЕ скрывать настоящий ранее введённый платёж из-заdraft/legalunknown. Новые7PDF не содержат банковскихфактов → payments0/paidDateпусто. Все измененияbankfacts только штатными защищёнными маршрутами.

Новый legal draft/source contract исключается из **ожидаемого долга/просрочки/прогноза** до подтверждения обязательства и событий. Legacy безlegal работает какпрежде. finance.service получает parents одним batchedquery/projection(mapпоorderId), неN+1. Дляновыхlegalконтрактов forecast использует paymentPlan одинразнадоговор, а не70/30покаждойстроке/деньотcontractDate; unknownEvent→ожиданиеуточнения, неoverdue. Подтверждениеstateбезsignature/eventнесоздаётдаты. Реальныеплатежиотчётыпоказываюткакраньше. НезависимыйфильтрproductionNoгруппируетcontractIDsбатчем, salesOrderIdсохраняетпрежнийсмысл.

Маршруты: роли+AppSection+AuditAction по образцам, записиadmin/manager, чтениекаксуществующийownercontroller. Суммы/налоги/проценты/платёжныестатусы/versionsnapshots не должныпросачиватьсячерезnestedlegal,issues/reason,history/PDFссылки иошибки к роли безденег. MoneyMaskInterceptor имеетограничениеdepth6 иименаполей: явный sanitizeLegalForUser навсехlist/detail/mutations/history/OfferPDF нужнее надеждынаавторекурсию. PDFоригинал содержитцену — readonlyuserбезденегнеполучаетегоfileId/URLчерезновыессылки. Это не менятьглобальныестарыеuploadsправабезотдельногоплана; протестироватьдоступкновомудокументувладельцу.

## 6. Дубли, файлы, индексы и миграция

intakeKey=SHA256(normalized companyINN|buyerINN|kind|fullnumber|sourceDate|edition), безглобальногоудалениясуффиксов/слешей. uid/hashинвариантнывпределахoperation. При одинаковомkey/другомcontent409сdiff, неsilentmerge; deletedmatched→409/manualrestore, неduplicatecreate. ОтсутствиеисточниковогономераКП: keyдополняетсяsourceSHA, негенерированнымnumber.

Новыеunique partialindexes наSalesOrder/Offer intakeUid/intakeKey иsourceIncomeуникальность должнывойтиensure-indexes; legacyбезполейнеучаствует, доиндексаread-onlyдубликатcheck. Photoзагружаетсяпослеопределенияexpectedowner, UID/SHAjournalдоupload; sourceSHAпроверитьсодержимом. Перезапускпослеunknownuploadсначалаread-proof, невторойPhoto. Толькоtypedattachexistingphotoвlegalcommit, no sharedstorageclones. Приудаленииparentоригиналыsoftownedистория, неслепойdeleteобщегоstorage.

Миграциядляэтапа1**не нужна**: optional поляпусты, старыеpaidDate/payments/importKey/productionNo/IDнепереписываются. Обязательныеиндексыadditive. Не massupdatetolegal:draftнаживойБД. Импортсемидокументовотдельныйplan→review→applyпослевыпуска.

## 7. Ownership и приёмка

- Backendintegration: common/legaltyped DTO/schema/helpers, salesorders, incomes, finance, ensure-indexes иmaskhelper; offersworkerчитаетобщиетипыноихнеменяет. Отдельныеlegalservices/helperмодулиможновнутрисуществующихпапок; циклы0.
- Offerbackend: offers.schema/dto/service/controller/logic/PDFpresenter, reusecommonlegal; неmenятьsalesorderscreateсамостоятельно, интеграционныйadapterпокоординатору.
- Frontend: salesorders/orders/offers иобщийlegaleditorпоdesignkit; existing «Привязатькзаказу»/matchingdialogs переиспользовать. NoUIсистемныхполей/hash. Правитьatlas/helpвтомжепакете.
- QA: atomicunassigned/replay/concurrentduplicate/CAS/UTF8file/sourceSHA/immutableoriginal/19rows0design/9offerrowsoneexcluded/unknownfieldseditable/2contractsonegroup/actualfactsnotmaskedfromreports/falseforecast0/noMoneydeepdetailsandfiles. Desktopобетемы1920/1024, source→reopen→fill→assign→replay. Коммит/выпускпослеполногоQA/независимогоreview.

Якоряпровереныадресно: salesorders.controller(roles/mask),salesorders.schema(SalesOrder),incomes.service:create(productByTitle/maybeAutoDesign),income.schema(источник/платежи),offers.schema(OfferItem/versions/date/orderId),offers.dto(OfferIntakeDto—AIparse),finance/forecast:prepayPercent/expectedOps. Контракттребуеткоординаторскогоразделенияобщихфайлов; веськод/проднеаудировались. КартаarchitectнеизмененапотомуownershipэтогопоручениятолькоCONTRACT.md; коммит:daacc7bc.

### Уточнения координатора при реализации
- Открытие оригинала использует существующий GET`/photos/:id`(PhotosController31–39), ответPhoto.storageUrl/originalFilename/mimeType/sizeBytes. Отдельный придуманныйfile-routeне нужен. FrontendполучаетfileIdтолькоприразрешённыхденежныхданных иленивозагружаетметаданные; noMoneyссылкинаюридическийPDFнеотдавать. Глобальныеисторическиеphotos/uploadsACLэтойзадачейнерасширяются.
- Legalредактор во вложеннойправойпанелиkit.openCard/ctx.parent поexistingorder-product-picker, без новыхsection/routerрадиформы. СохранениеCAS, обновлениеparentпослеуспеха, dirtyguardиошибкибезпотериввода.

- Дополнение реализации: новаяsourceIncome получает sourceUidизобязательногоclientUid и шестойpartialuniqueиндекс c164_income_source_uid. Это защитаодинаковогоUIDсразнымистрокамивконкуренции; legacyclientUidостаётсякакбыл. Новыйиндексвходитвscopedplan/apply/gateвместесисходнымипятью.
