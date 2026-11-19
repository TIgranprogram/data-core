# C158 / C161 — состояние координатора

19.11.2026. Рабочая копия: `C:/Users/User/.codex/worktrees/c158-invoice-fields/data-core`, ветка `codex/c158-invoice-fields`, основа `179c6239`. Исходный checkout содержит чужую работу C155 по паспортам; её не переносить и не откатывать.

## Текущая работа

- C158 backend READY: исправлены валютные долги/оценки, scope legacy, агрегаты вместо всей истории, replay после смены реквизитов. 256 unit/23 e2e/tsc PASS. Архитектор выполняет повторный review; исходный FAIL не считать закрытым до его отчёта.
- C158 frontend исправил неизвестный НДС и needsConversion. Повторный BROWSER C158-UI-1795097544593 PASS,15PNG; отдельные history/error снимки для designer ещё нужны. На стенде61счёт, ни одного payments[] в GETlist, у всех61 paymentsTotal. OpenAPI518paths обновлён.
- QA full unit355/355 suites,3648/3648 tests PASS, tsc/build0. Full e2e идёт: старый supply-invoices fixture использует поставщика вместо своей компании,4падения pay400; QA правит фикстуру и старое ожидание PATCHamount200 на контрактное409 после ledger. Новые QA3теста rollback/rounding/void добавлены отдельным файлом. T26opt-in12SKIP согласованы без дополнительной disposableБД.
- C161 контракт уточнён root после ARCH-PLAN-REVIEW. Приняты source matrix, единый writer всехaliases/genericadmin, IDs доходов, совместимая legacyпроекция. Frontend начал helpers/dictsfinancialbranch, затем money operations и recursive selectors. Backend C161 ещё не начат; C158 src зафиксирован до QA/review. Frontendgeneratedpreload index.html разрешён точечно.

## Изолированный стенд и приёмка

Owned project `dc-f9f4ea383bd66a4c5d81e48b-night`, runId `f9f4ea383bd66a4c5d81e48b`, API3198, Mongo27158. База копии и отдельная testDb имеют этот runId. Копия18.11. Actual run.json initialized=true; старый pointer current-stand.json содержит false. Доступ только datacore-access через api.sh; секреты не читать и не выводить.

В `deploy/synology/api.sh` две временные локальные настройки stand3198/cache: НЕ включать в коммит/выпуск. Access должен восстановить после проверки.

Координатор проверил `tools/logs/c158-ui-check.mjs`: strict origin3198, fake fixtures только копии, сессия stdin, собственный headless Edge profile и проверенный cleanup. Первый BROWSER `C158-UI-1795096430186`: RUB с авансом/доплатой PASS, UE draft FAIL из-за fabricated VAT default. Evidence сохранены, frontend исправил причину. Запускать снова только после backend ready и refresh.

Нужны: итоговые unit/e2e, UI filled scenarios обе темы/ширины, независимые QA и designer, второй architecture review, OpenAPI и docs-sync. Никакого выпуска до фактической приёмки.

## C161 и статьи

Рекурсивное дерево в существующей expensearticles, постоянные ID, редактируемые имена/родители, архив, явный income/expense. Отдельно статья, объект/заказ, направление, компания и денежный факт. План183 ID:159 KEEP,11 MOVE_PROPOSAL,13 REVIEW. Текущие14 корней сохраняются; предложенные ранее8 групп не утверждены. Исходник read-only в C158/data (gitignored). Неизвестные usage/revision получить перед применением плана; на проде статьи не менялись.

## C157: импорт отложен

Счета вносить только после проверки и фактического выпуска необходимых доработок. На проде ранее по отдельному подтверждению создан и оплачен только БЕТОНМАСТЕР4816, поставщику установлен НДС22%; не дублировать. Остальные файлы остаются в реестре. Основной регистр и напоминание пульта `c157-import-after-financial-fields` в исходном checkout. C157 REGISTER/GAPS/ACCESS-REPORT доступны и здесь. Нового импорта в этом этапе не было.

Коммитов, push и deploy текущей реализации ещё нет. Не закрывать задачу по типам/линтеру без UI и архитектурной приёмки.


## Адресный пакет после полного QA и повторного review

- QA полный e2e:76PASS/4FAIL/1SKIP suites,595PASS/10FAIL/12SKIP tests;4старыхsuite имели fixtures supplier-as-payer/новые финансовые ограничения, QA исправил их. Нельзя объявлять этот сырой прогон зелёным. Новые QA3 и backend23 PASS; target6выявил реальные regression invoice_paid pricehistory и400вместо409; остальные TSфикстуры QA исправил.
- Backend сейчас исправляет одним пакетом: единый список валют включаяCNY; expectedVersion first даже безdto.version (idemlookupраньшеCAS); транзакционный onFullyPaid callback дляrecordPrices; addRequestsledger409; legacy reconciliation. Root посмотрел адресный diff двухP1: обеFXquery используют FOREIGN_INVOICE_CURRENCIES, expectedVersionпроверяетсяпослеpriorlookup. Ждём фактических тестов, третьего общего architecture review не требуется согласно его 2-му отчёту.
- Legacy21427 подтверждёнstandAPI: nosnapshot,inv.amount36824.24,currentlines153980. Ответдофикса ошибочноpaid/sourceBalance0/balance117155.76. Новый shape принятвCONTRACT: reconciliationRequired/reason, paymentState=reconciliation, неизвестныеpaid/долгnullбезsnapshot, известнаяоплатацелостногоснимкасохраняется. UI уже поддерживает«Требуетсверки», действияоплаты/legacyunpayблокируютсядосверки. Данные/старуюисториюденегнепереписывать.
- Досъём C158-UI-REVIEW-1795098194258 PASS14PNG: открытаяистория2оплат/createdAt, explicitVATerror, сохранённыеUE360/30326+основание, обеtheme1024/1920, geometryoutsideHorizontal=[]в14состояниях. DesignerпервичноPARTIAL, followupнаэтиновыедоказательстваещёнужен. Axeотсутствует, PASSемунеприписывать.
- C159frontendвработе. Rootmain.jsзарегистрировалсобственныйLAZYmoneyclassification→moneyClassification,OWNERmoney;LOADER_OFaliasненужен. ВконцеC159CONTRACTпринятыGEToperationdetail, additivearticleRows, dynamicmonths/cross-year≤366, expectedPaymentId/versionвстаромDELETEincomepayment. ПослеC158fix/test backendвозьмётC161.
- Accessсобираетсвежийread-onlyusageC159черезprodAPI(вт.ч.admincollectionsAPI,неMongo). Разовый502закончилсяhealthok,сверкаидётпоследовательно;невыдаватьотсутствующиеversions/archivalfieldsзанули. ДанныеgitignoredC159/data,применения/созданиягруппнет.
- Напоминаниепультаc157-import-after-financial-fieldsскопированоизисходнойпапкивнашpult/todo.json(толькоэтотпункт,другиесохранены). Импортвсёещёотложен.


## Последнее состояние: C161 core9PASS, первый whole-review, фиксы идут

- C158 адресный QA принят:6suites71PASS+258unit/tsc0. Фактическая выдержка двухterminalchunks7f7f5e/e63490 session36504 сохранена backend-final-targeted-tool-output.txt, JSONдополненsource/excerpt; QAпроверил/хешировалобаартефакта. RawfullстарыйFAILсохранён, finalfullещёнезаявлен.
- Root открыл4новыхPNG1024 run1795098955008(historylight/dark,vaterrorlight/dark):2строкивидны,inlineerrorцеликомвышеfooter. UI-REVIEWдополненадреснымPASSэтихусловий. Новаяreconciliation21427ещёждётrefresh; послеC159UIhelperпроверитегоJSON+снимки.
- C161 articles implemented/freezed;2e2e12PASSдоarch,108unitPASS. Послеarch3pure/writerветкиисправлены(rootNULLтолькогруппа,invalidancestorspropagate,legacyprojectionвсеdescendants/archivedIDsсflags);обновлённый14testtarget12PASS/2fixtureFAIL,обаfixtureCategoryuniqueисправлены,ТОЛЬКОэти2newtestsPASS10.826s. Необъявлятьэтооднимполным14/14run; будущийFULLQAобъединит.
- Core C161 реальноисполняется:9/9financial-operationse2ePASS13.848s (evidence/core-e2e-2.json,rawtools/logs/c159-core-e2e-2.log). IDs/identityplan+synthetic/raw0/fact1,mapping,7rows/fulltotals/BOTH,resetarchivedoriginal,legacycarry,crossyear/scopes. Core НЕ finalREADY: закрывает первыйwholeARCHreview4P1+P2, добавляетperf/security/rollback/replaytests. TestDbпоследнимarticlesосвобождена,нуженэксклюзивныйstartcoreчерезroot.
- Первый wholeC159ARCHreview(архсейчасзавершён) готов ARCH-REVIEW.md: P1payrollsourceAppSectionbypass; P1cancel/move/remove/restoreIncome sourceCASvsfirstpay; P1legacyordinaryanalyticPATCHSupply/Expenseбезoriginal; P1UTCtodayvsMoscow. P2heavyhistorylist/cashflow,objectmodecontractPricebyarticlescompat,unchangedarchivedIncomePaymentвалидация. Всёпереданоcorebackend. Послеегоfreezeнужен2-йАДРЕСНЫЙreview, не3-йобщий.
- Доп.rootpolicy: новаяinvoiceallocationНЕнаследуетstalearchived/group/invalidhint:реальнаяоплатасохраняетсяarticleIdnull+warning, explicitbadnewselection400; legacycarry/resetсохраняютисторическуюoriginal. Lookup/validchosenarticleвsession+referenceGuard. Coreполучилзадачу, ещёневыданfinalPASS.
- C159rootполитикаsourceprivatePayroll: новыеlist/detail/PATCHтребуютmoney+sourcepayrollsection+canSeePayroll. Нефабриковатьaggregatepayment; расходящаясяsourcepermissionselectionотстарогокалендарявUI/metadataдолжнабытьявна, неclaimsamefiltertotal.
- C159frontendвыполнен,61node/350guards/355imports0/designlint0; helpers/tree/dicts, доходныеarticlerefs/expectedPaymentID,operations/fullfiltertotals,classification/read-detail/retry/reset,identityprepareplanreview+confirm+mapping(безтехIDнаUI). includeUsagedefaultfalse, толькоdictsредакторtrue,cachekeytype/archive/usage. ParentNULLarticleтеперьdisabledplaceholder/проверка,нельзяавтоподставлятьпервуюгруппу.
- RootдобавилFinancialArticleвensure-indexesMODELS(nodecheck0); Counter.referenceGuardoptionalбезdefaultнапрочихcounter; HttpExceptionFilter409пропускаетsafeintcurrentVersion/currentTreeRevision+planТОЛЬКОreadOnlytrueobject;16unitfilterPASS. MAP/ARCHITECTURE/data-modelобновляются, coreдокисинхронизироватьпослеREADY.
- Rootготов/проверил tools/logs/c159-ui-check.mjs (ещёнезапускался):strict3198/stdinsession/ownEdgecleanup,создаётТОЛЬКОownedfakeourcompanyvalidINN,6articlestree3levels,2lineinvoice255000(55000+200000),income100000(60000article/40000explicitnull),expense7455;контроль7rows/5payments/totals100000/262455/-162455,limit2+BOTHreports,classify→rename/reparent/archive→resetarchivedoriginal, optionallegacyIncomeidentityplanнаownedкопии,legacy21427reconcileJSON/screens. EvidenceC159; sourceAPIwritesтолько3198,нетprod. Послеcorefreezeпроверитьскриптещёраз/передатьaccessrefreshBROWSER+OpenAPI. Signaturemetadataошибкиhelperаотделятьотпродукта.
- AccessC159freshread-onlyinputготовVERSIONED-PLAN-INPUT.md+gitignoreddata:183articles,242requests,71invoices,219incomes;183ID/name/parentполностьюсовпали;15legacy snapshots/34linesБЕЗarticleId,6resolveтолькопотекущейзаявке(неисторическийснимок),7categoryhints. Все5collectionsAPIпрочитаныполностью,versions/type/archive/treeRevдоC159missing=unknown. Передapplyнужноповторитьпослерелиза. Продзаписейнет.
- Rootдобавилручнуюсверкуlegacy21427вDATA-FIX-USER иpulttodo(idc158-reconcile-invoice-21427);данныенечинил. Толькоуказаныданныекопии18.11,переддействиемпользовательсверяетактуальныйсайт/первичку.
- Originalmain gitlogbfa2774a(Windows/Cygwin deployfix),тамC155ещёdirtybackend/pwa/passports/products/atlas/help+docs/pult,чужоенетрогать. Originalgitstatusnormal sandboxложноfatalnotworktree; require_escalatedreadпоказываетреальность. Передвыпускомнужносведениеобщихфайлов/актуальногоmain,необходитьCLAUDEreleasegateсdirtyсоседом. Коммитов/push/deployнашегоC158/C161ещёнет.
