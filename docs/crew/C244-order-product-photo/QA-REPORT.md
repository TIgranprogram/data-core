# C244 — независимая финальная QA
PASS | unit406 suites/4175 tests; e2e112/112 suites/918 tests,0FAIL/SKIP/missing/extra/duplicates; tsc0/ESLint0 explicit59TS.
✅ Реальный HTTP4/4: income-original выше каталога, каталог выше passportoverview; новый импорт виден повторным чтением, photoIds автоматически не копируются.
✅ Удалённые/чужие kind/product исключаются; смена изделия не оставляет прежнее фото, отсутствие даётnull; unit дополнительно проверяет unsafe/invalid/variant/legacy и следующий пригодный оригинал.
✅ Closed/live projection сохраняет frozen bundle/chunks/SHA/download; lines-lookup сохраняет прежний explicit-only контракт; все прежние caller-наборы включены в full.
✅ BatchNoN1: исполнение реального resolver в unit для1/100 строк общего изделия даёт5batch-запросов, пустойнабор0; это unit query-counter, не HTTP command-counter.
✅ SHA всех src/test TS совпали доunit/передe2e/после; новыхTS0,6/6 author-freeze SHA совпали. Итог: qa/full-summary.json и final-source-sha256.json.
✅ Browser6/6 и дизайнер UI-REVIEW PASS: реальный owned API с QA-заказом/6шт/QA3413, decoded фото light/dark; own/none — явно UI-only response fixtures, не API-priority proof.
Команды: qa/run-release.ps1/run-full.ps1; dynamic manifest112=102ordinary+10strict в7группах,oneJest/RAM6144/штатные60s; stdout tools/logs/c244-run01-*.log.
Изоляция: ownedmongo4.4/rs0 loopback27237,ordinary datacore-test-c244-run01,C244 datacore-test-c244-photo,T26 новаяdatacore-test-t26-c244-run01(optin1),остальныеstrictguards прежние; retry не потребовался.
➖ Production UI/данные не проверялись этимQA; прод/живые модели/фото/архив не менялись, runtime/test послеfreeze QA не правил, секреты не читал; Mongo retained.
Якоря: backend/test/e2e/c244-order-product-photo.e2e-spec.ts:32, backend/src/common/product-photos.spec.ts:70; browser evidence/browser/summary.json; карта обновлена, коммит:f6b35fc5 (истинаfinalbytes — SHA).

