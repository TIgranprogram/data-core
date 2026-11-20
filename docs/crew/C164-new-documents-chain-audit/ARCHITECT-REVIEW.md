# C164 — независимый архитектурный review

20.11.2026. **Итог второго прохода: архитектурный PASS.** Пять исходных P1 и адресный CREATE-gate закрыты. Полный QA, живой UI, выпуск и импорт — отдельные обязательные этапы координатора. Ниже первоначальный пакет сохранён как история, а не текущие блокеры.

Первый проход: после устранения P1; выпуск/импорт был запрещён. Просмотрена реализация относительно59f47957, первый frozen checkpoint568b2fdd. Координаторский source manifest2090файлов начинается46def04; полный путь/SHA добавить при втором адресном проходе. Никаких правок кода/API/данных/секретов этой ролью.

## P1 — один исправительный пакет

1. **Утечка денег noMoney.** `offers/offers.service.ts:62,65,73` возвращает новый agreedTotal и versions.snapshot; `common/interceptors/money-mask.interceptor.ts:32–47` удаляет legal/sourceLine, но agreedTotal отсутствует вMONEY_FIELDS и versions/текстыreason/notes не очищаются. Собственный вызов реального MoneyMask дляroleuser/GETвернул `{agreedTotal:2061000,versions:[{snapshot:{agreedTotal:2061000,notes:'Согласовано2061000₽'}}]}`. Нужно удалить новые денежные поля и финансовую историю/свободные подтверждающие тексты, а не надеяться наdepth6; list/detail/mutation/history проверить одной матрицей. PDF403 уже реализован, повторная реализация не нужна.
2. **Sourceпуть создаёт дубль legacyдоговора/корзины.** `salesorders/salesorders.service.ts:392,407–408`: sourceпоиск только intakeUid/intakeKey, затем importKey=`source|hash` и taken=null; legacycompany|number/clash намеренно обходится. Поэтому existing/deletedlegacyс тем же документом без новыхintakeполей не находится и не конфликтует ни с однимnewuniqueindex. Источниковые повторы между собой защищены, crosspath — нет. Нужна общая граница повторного бизнесдокумента дляlegacy/newwriters и узкая сверка имеющихся company+полныйномер+date+buyer(еслиизвестен), включаяdeleted. Unknownbuyer/date/mismatch —409с существующимID/основанием, неsilentmerge/второйдоговор. Не ломать разные клиентские договоры с одинаковымномером: точные стороны/дата при сравнении, legacyimportKey сохраняется.
3. **Nullотвязывает исходную позицию.** `incomes/incomes.service.ts:422` проверяет `dto.orderId&&...`; nullпропускается, `:219` превращает его вundefined, `:445–449` делает$unsetorderId. IncomeDto.orderId=null допустим (собственныйclass-validator0errors). В результате неизменная sourceLine остаётся, но пропадает договорная/отчётная связь. Дляsource/manual: проверить `orderId!==undefined`, запретитьnull/чужойID; совпадающийID допустим. Аналогичные очищающие значения проверять до toFields.
4. **FXзащита обходится обычным CREATE.** `incomes/incomes.service.ts:358–370` проверяет currencyтолько приdto.sourceLine. ОбычныйPOSTincomes под уже существующий legal.currency!=RUB не передаётsourceLine и проходит legacyрасчётamount врублях. Позже исходныеединицы могут статьрублёвым фактом/ожиданием. Проверять валютуparentдлялюбой новой/переносимой позиции; пока нетявногоRUBconversionконтракта —rejectдляnonRUB. Вawaiting (`finance.service.ts:175,271`) guardтакже должен исключатьFXбезучётногоRUB, а не толькоdraft/signatureunknown. Цель не скрывать старые подтверждённыеRUBfacts, а не допустить нового ложногоRUB.
5. **Ручное сопоставление запускает проектирование.** Координаторскийtargetede2e: до0, после `/matching/none`→assignдвухsourceдоговоров2designTasks. Узкий подтверждённый путь: `matching/matching.service.ts:184–187` безусловно вызываетdesign.autoFromOrderIfReady дляorderIDs; Income.maybeAutoDesignmanualguardсюда не применяется. Нужно общее source/manualограждение в вызываемомauto-designhelper либо во всехвходахmatching/apply/none/assign/convert. Ручная связьизделия сама по себе не разрешает запускпроизводственной/проектной задачи. Сохранитьlegacyавтоповедение. Сценарий повторить одним e2e послефикса; не объявлятьошибкойсамоassign.

## P2 — скорость и пределы

- `offers/offers.service.ts:267–270` читает весь документ длякаждого listpage: новые legalHistory/versions/orderConversion.snapshot вместе сPDFmetadata/историей, хотя present(detail=false) отдаёт summary. Исключить тяжёлыеhistory/receipts/internalconversion изDBprojection; legalнужен лишь ограниченныйsummaryinput. АналогичноsourceLineвlistitemsпереноситсяцелым; sourcehistory только по карточке/действию.
- `offers.service.ts:219–224` matchingexistingcontract читается доCASтолькоКП, без parent/lineверсии. Приконкурентномредактированиистрок связаннаясверка может устареть. Приsourceimmutableполях это ограничить сравнениемисточников, либо транзакционный/CASread-proof связанныхлиний. Не создавать сложнуюденежнуюсистему радиэтойсвязи; сохранитьпометкуверсиисверки.

## Что уже устроено верно

TypedLegalBundle/SourceLineSchema вместоMixedдляюридическогосодержимого; immutableоригиналы+SHAпоbytes; отдельныйlegalVersion/history/receiptCAS/replay; additiveполя и6scopeuniqueindexes сfailclosedreadiness; sourceorderunassignedбезсчётчика; Included/excludedКПсраздельнымoriginal/agreed; реальныйpaymentнеисчезаетиззаdraft; новыйeventforecastотделёнотфакта. Всё это не отменяетP1crosspath.

## Собственные проверки и границы

- 5unit suites/27tests PASS: legal-utils/source-indexes/offer-source/offers.source-conversion/legal-forecast. Один ts-jestwarning оJSallowJs, неFAIL.
- `node backend/scripts/audit-cycles.js`: взаимныхпар0.
- Read-only runtime probes MoneyMask и DTOorderIdnull — результатвыше, API0/DB0.
- Roottargeted3e2e:11PASS/1FAIL, последнийmanual→design указанP1-5; fullне запускался дофиксов.
- review-scopearchitect приштатномgitсначалаdubiousownership, затем с process-onlysafe.directory показал историческийscopeот267bc1c и огромныйобщийхвост. Он не объявленпроверенным и `--done`не ставился: этототчёт ограниченC164diff59f47957→568b2fdd+новыелокальныефайлы. Картаarchitectнеизменена иззаownershipтолькоэтогоотчёта, якоряздесь.
- Типы/full/e2e/desktopпределы — отдельныеQA/designer доказательства координатора; визуальныйPASS по чтению не заявляю. Второй проход толькопо5P1/P2изэтогопакета и frozenmanifest; третьегообщегокруга нет.

## Решение координатора о P2
Проекция списка исправлена в пакете1. Конкурентная связь КП↔договор фиксирует историческое соответствие, не платёж/производство; для текущего импорта сопоставляются проверенные неизменныеsource-снимки C164 и прямое решение владельцаS1. Предел конкурентной правки текущих строкlegacy остаётся отдельным P2, не закрыт словамиобimmutable. Дополнительный guard/read-proof versionсвязанныхстрок отложен в BACKLOG; actualsourceсвязьнеиспользоватькакразрешениебанковскойоперации/акцепт. Финальныйreview2долженподтвердить5P1; этотявныйP2невыдаватьзаисправленный.

## Второй, финальный адресный проход —20.11.2026

Проверен568b2fdd→b09b6f773a1dc5ae70492ff9f02df020e1ed11aa плюс frozenowner-дополнение photos/grouping. Source manifest2093файла, SHA `1a146a0f486bb5fe4c4d8138ecb448e4b1b9e9cfb4544f9b22f742a173c0bc86`, QAснимок04:35:55UTC. **Пять исходныхP1закрыты; один адресный остаток новогоowner-productiongate ниже.**

- P1-1закрыт: MoneyMask удаляетagreedTotal/sourceTotal/versions/snapshot/exclusionreason иденежныетекстыновыхsourceкарточек; noMoneyсохраняетпагинациюtotal. Роли/PDF403неослаблены.
- P1-2закрыт для текущего company|номер контракта: source/legacy используют единый uniqueimportKey, новыйsource требуетсовместимыйбизнесиндекс;clashвидитactive/deleted/unknowncompany, duplicate/concurrent конфликтне создаёттеневойдоговор. Новыеintakeиндексы/receiptsостаютсяотдельно. Разныеподтверждённыепокупателисодинаковымномеромпо-прежнемумогутполучитьконсервативный409(legacyограничениеключа), небесшумноеслияние.
- P1-3закрыт: присутствиеdto.orderIdпроверяетсячерез!==undefined, null/чужойIDsourceстрокивыдают409.
- P1-4закрыт: assertAccountingCurrency вызываетсявCREATEлюбогоIncome иприпереносе; awaitingтакжеисключаетnonRUBlegal. Реальныеранееучтённыефактыпо-прежнемуотдельны.
- P1-5закрыт: Matching.none/applyисключаютmanualsourceисмешанныедоговорыизautoDesign; legacyавторежимсохранён. Собственныйmanualsourceunitподтверждает3ветки.
- P2projectionзакрыт: DBспискаКПисключаетversions/legalHistory/receipts/orderConversion, versionCountсчитаетсяотдельнойпроекцией, ненулёмвместоистории. P2конкурентноголинкованияКПостаётсяявносогласованнымпределомвыше, неисправлен.

### Дополнение originalPhoto и группировка

`legal-utils.ts:54–56`: SHAпроверяетсяпобайтам, затем serverPhotoCASsourceProtectedдоparentCAS и повторнаяпроверкаsourceDeletingуstorageURLalias. `photos.service.ts:315–345`: всеID/variants/storageURLaliasesзахватываютсяsourceDeleting+ownUUID;partialclaimснимаетсятолькоownUUID;rawrefsпроверяютlegal/history/versions/supplyinvoicesвключаякорзину, затемтолькоdeleteOne/unlink. Attachвыиграл→delete409;deleteclaimвыиграл→attach409доlegalwrite. БезопасныйprotectedorphanпослеparentCASFAILсохраняетбайты, разбираетсяC167, неавтоматическиудаляется. Удалённыйaliasможетконсервативноблокироватьlegacydelete; этоограничениеreconcile, непотеряданных. MockedCASunitнеравенproductionracee2e; полныйархив/ownership/reconcileC167необъявляетсяготовым. Обычноеудалениенепривязанногофотоиvariantsпо-прежнемупровереноunit.

`production-orders.service.ts:65,86,112`: новыеlegal/manualдоговора можнообъединитьдогруппыдоmatching, legacyassign сохраняет прежнийmatchgate. `salesorders.service.ts:435–441`: реальныйпереходnew→production/readyтребуетматчинга, иproduction-orders.setStageиспользуеттотжепроверяющийметод. Группировканеделаетdesign/stock/paymentопераций.

### Единственный остаток нового gate

**P1-GATE**: `salesorders.service.ts:createDocument.stage` всёещё`f.stage??'new'` безassertHasLines; SalesOrderDto.stageдопускаетproduction/ready. ПрямойPOSTсinitialLegalиstageproductionможетсоздатьпроизводственныйдоговорбезстрок/матчинга, обходяновыйUPDATEgate. Требуетсяузкийrejectnon-newstageдляCREATEсinitialLegal(включаяmanualderived), legacyбезlegalне менять. Послефиксапривязатьокончательныйmanifest; общего третьегопроходане требуется.

### Проверки второго прохода

Собственные9targetedunit suites/50tests PASS,10.647с: MoneyMask, legal-utils/source-indexes, manualmatching, photoreferences/serialization/legacyremove, productionassign, legalforecast. Циклы0. ts-jestallowJswarningнеFAIL. ФактическихAPI/БД/продвызовов0. RootQAнапредыдущемFIX1manifestddca646:3e2e15/15+noMoney3PASS; новыетестыphotos/groupдополненияещёожидаютобщийfreezeпрогон. Full/UI/выкладка/indexapply/импортостаютсяотдельнымипроверкамикоординатора. Старыйисторическийscope267bc1cнепроверялся/непомечалсяdone; якорятолькоздесь(ownershipотчёта).

### Финальное закрытие P1-GATE (тот же второй проход)

`SalesOrdersService.create:384–386` теперь отклоняет любой переданный non-newstage при initialLegal **доtoFields/чтений/записи**; legacyCREATEбезlegalсохранилповедение. Собственный отдельныйunit `c164-source-create-stage.spec.ts`:1suite/5tests PASS,8.39с; production/ready/partly/shipped/closedотклоненыдоданных. Это адресная проверка остатка второго прохода, не новый общийreview.

**Финальный вердикт: архитектурный PASS с явными P2/C167пределами.** Пакет2093/1a146выше относится к состоянию ДОэтого последнего guard; он не называется текущим QAfreeze. Координатор должен зафиксировать новый общийmanifest для full QA/выпуска, включаяguardиnegativeunit. ИныхизмененийпослеревьюбезпроверкивэтотPASSневключать. Дополнительно:50tests/9suites и5tests/1suite — два реальных адресных прогона, а не один55testfull; полныйunit/e2e/UIэта роль не выполняла.

Адресный финальный SHA256 `backend/src/modules/salesorders/salesorders.service.ts`: `4d14e988857abf0db73975fc3d576e1502917827336e64cc4d43a298dcb76c15`.

Адресный финальный SHA256 `backend/src/modules/salesorders/c164-source-create-stage.spec.ts`: `bbb0218de2fc1e8ab41316d67b1d9a979ba2975ebb92f56d61215bb98022ad8e`.
