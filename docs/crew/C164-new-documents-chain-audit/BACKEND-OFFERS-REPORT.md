# C164 — сервер КП

20.11.2026. Статус: код и локальный smoke PASS; общий e2e/дизайнер/архитектура/выпуск ещё не выполнены.

- Additive DTO/schema: sourceNumber/date/initialLegal/intakeUid + partial uniqueintakeindexes; typed sourceLine/rowKey/manualmatch/exclusion и согласованный итог отдельно от исходного.
- create: реальныеPhoto bytes/SHA/стороны/исходная дата/итог проверены, index-readiness503failclosed, contenthash безUID дляsamebusinesskey replay, конкурентныйE11000readproof; deleted/changed409.
- PATCHsource: CASlegalVersion, draftверсии, исходные строки/количество/цена/снимок неизменны; matching/scopeсисторией. PATCH/:id/legal используетобщуюtypedCAS/history/replay.
- POST/:id/link-order сверяет компанию, клиента, активные строки/количества/габариты/суммы; не меняетstatus/оплату и не создаётдоговора/Income.
- explicitcreate-order newlegal: includedonly/manual/unassigned, gross=agreed; дата/подпись/платежи нового договора неизвестны. CASpendingjournal замораживаетисточник, stablehead/rowUID, resumeпослечастичногосбоя; DONEreplayне создаётповторы. Legacyпутьсохранён.
- ListneedsReview/summary безfulllegal/history; GETdetailдобавляетисторию; noMoneyPDF/preview403 и общийMoneyMask дляnested. ВгенерируемомPDFисключениеявнопомечено, originalPDFбайтынетрогаются.
- Преднамеренноеограничение: историческоеlegalКПнельзякопироватьна другуюкомпаниючерезlegacycopy/copies; отдельноновоепредложение, чтобынеутверждатьложныйюридическийисточник.

Проверки: tsc--noEmit exit0;15offer suites/85testsPASS; eslintoffers--quiet exit0; diff--check0. ПослеэтоготолькоadditivegeneratedPDFhistoryannotation(родительскийfullперепроверит). Новоеe2e `test/e2e/offers-legal.e2e-spec.ts` подготовлено, самостоятельноНЕзапускалось: реальныеuploadbytes/concurrentcreate/CAS/link; общийQAкоординаторомнаownedtestDB.

Интеграция: общиеhelpers/маскирование/indexensureвладениеbackendcontracts; frontendcreateOrderдляlegalпередаётversion, legacyбезнего. Индексыименованыc164_offer_intake_uid/key и должныбытьсозданы штатнымscopedrunnerдоимпорта; безнихsourcecreate503. НиAPIprod/standниsecretsнидаты/платежипрода не читались/не менялись. Не коммитил/не выкладывал.
