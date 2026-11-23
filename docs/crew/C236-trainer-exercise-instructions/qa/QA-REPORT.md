# C236/240/241/242 — независимая финальная backend QA
PASS backend | ✅full unit405 suites/4167 tests; tsc0/ESLint0 explicit53TS, финальный код TX2+Swagger.
✅Full e2e111/111 suites,914/914 tests;0FAIL/SKIP/missing/extra/duplicates. ОдинJest,4последовательныеобычныеbatch+6strictгрупп,RAM6144,штатные60s.
✅C236/C241/C170 HTTP3/74; C240/C2422/14, в том числе direct/batch count multiple409/nochanges/stale single; stockscope14 и order-line-plan7 PASS.
✅SHA всех src/test TS совпали доunit/перед111/после111, новыхTS0; freeze-before-start.json/final-source-sha256.json/full-summary.json в qa/run05.
История не скрыта: run01 create→snapshot409; run02 correcttimeout+старыеSM6; run03 partialSwaggerfreeze; run04 Гант lockwait64.852s — отдельныеFAIL/partialартефакты.
T26setupFAILнаповторнойdatacore-test-t26-c236 сохранён t26-fixture-reused-db-fail.json; разрешённыйединственныйповторнаНОВОЙdatacore-test-t26-c236-run05→12PASS,старуюБДнечистили.
Команды: run05/run-release.ps1,run-full-original-reused-t26.ps1,rerun-t26-command.ps1; stdout tools/logs/c236-run05-*.log, итог110новыхsuites+новыйT26приодинаковыхSHA.
Изоляция: ownedmongo4.4/rs0/127.0.0.1:27237,labelsC236/ephemeral=true; guards/DTO/таймауты не ослаблены, QA runtime не менял, prod/секреты не трогал; Mongo retained.
➖UI C236/C242 и настоящий Inventor принимаются отдельно; readOnlyPDF preservation не обещает byte-identicalPDF, first-print pdfIssuedAt/updatedAt из BACKEND-REPORT учтены.
Файлы: QA HTTP count backend/test/e2e/c242-stock-catalog-http.e2e-spec.ts:62; SM6 stock-scope.e2e-spec.ts:190; отчёты соседнихзадач ссылаютсясюда; карта обновлена.
