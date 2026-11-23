# C242 — независимая HTTP QA, 23.11.2026
PASS финального backend: независимый HTTP8/8; full unit405/4167 и e2e111/914, tsc0/ESLint0(53TS), SHA unchanged; реальная MongoDB/Nest.
✅ 124 трубных позиции: global numeric sectionSize asc/desc через 8 страниц по17, стабильный порядок/priority, круглое сечение и unknown/conflict в конце обоих направлений.
✅ SheetSize/woodSize и ось width численно различают2/10/100 через HTTP-страницы; не используют лексикографическую сортировку страницы.
✅ Нулевая80×60×3 без storageitem видна при5написаниях поиска, lookup/categories; quantity/free/unit/profile верны, storageitems/движения до-после неизменны.
✅ availability none/in/default, fully-reserved positive/free0, held/status/search/zone AND, total/counts, invalid/empty/repeatedquery400 и warehouse/category scope проверены HTTP.
✅ Реальный change-stream cache включён публичным lifecycle на test-БД; общий Promise/исходные строки не мутируют sort/availability/scope, повтор списка совпадает; fake connections нет.
Проверка: `MONGO_DB_TEST=datacore-test-c240-c242`, штатный harness, `--runInBand --forceExit --silent --json --runTestsByPath test/e2e/c242-stock-catalog-http.e2e-spec.ts`; ESLint0.
Доказательства: `qa/http-independent.json`, `qa/summary.json`, полный stdout `tools/logs/c242-qa-http.log`; expected union новых двух suites для full — `qa/full-plan-union.json`.
➖ Initial setup FAIL сохранён отдельно: мои raw категории не имели type/unique skuPrefix/slug; исправлены только фикстуры. Третий адресный повтор разрешил координатор; индекс/DTO/guards не менялись.
✅ HTTP direct/batch count stale single→multiple409/nochanges; SM6 zero/held/availability/scope и correct14PASS после TXфиксов; [общая QA/история](../C236-trainer-exercise-instructions/qa/QA-REPORT.md). UI отдельно, prod QA не трогал.
Якоря: `backend/test/e2e/c242-stock-catalog-http.e2e-spec.ts:62`, `:89`, `:131`; карта обновлена, коммит 36bdd4dc.

