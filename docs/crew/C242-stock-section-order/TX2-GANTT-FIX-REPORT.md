# TX2 — первый PATCH шага Ганта
PASS авторского прогона | frozen SHA runtime/spec — qa/work-schedule-freeze.json; опорный коммит18ef2ec5.
До fix: полный QA run04 единственный FAIL order-line-plan.e2e:100, первый PATCH109не завершался60s. Mongo history QA фиксирует salesorders find64852ms/Collection.r wait64851886µs: C236/qa/run04/plan-timeout-mongo-history.jsonl; batch-1.json. Авторский deterministic unit доfix2FAIL OUTSIDE_SESSION:incomes — qa/work-schedule-session-before.json.
Причина: withPlanWrite занимал договор через claimWritableOrders, затем patchStep→barsOf читал sources(incomes/worktasks/worktypes/salesorders/designtasks/products) вне session. Внешний read мог ждать DDL за lock той же незавершённой транзакции; это тот же тип self-wait, а не основание повысить timeout.
Fix ровно1runtimeфайл work-schedule.service.ts: optional ClientSession в barsOf/workTypes и все reads, передача из patchStep; person/worktypeeligibility тоже в session. Для session6источников читаются последовательно, workTypes обходит и не публикует глобальный кэш. Обычный range/postcommit сохраняет parallel/cache.
Не менялись shared withPlanWrite/withOrderWrite, claims архива, ревизии/CAS, расчёт дат, response послеcommit, маршруты/DTO/permissions.
После fix полный реальный HTTP order-line-plan7/7PASS12.926s; прежний тест100—89ms. PATCH10920021ms→второйперенос20018ms→stale4098ms; конечная полоса сохраняет новую ревизию/дату. qa/work-schedule-http-after.json и work-schedule-patch-chain.json.
Unit модуля4suites/24testsPASS5.525s,tsc0/ESLint0/diffcheck0. Новые3sessionрегрессии: exactsession/CAS, personeligibility, прогретый cachebypass+no parallel sessionread+негативный400 без изменения шага.
Все авторские Jest завершены; ownedMongo27237currentOp по datacore-test-c242-plan-timeout и всем transactions=[]; чужие процессы не завершались. Ни одного увеличенного timeout/skip/отключенияиндексов.
Архитектор согласовал scope перед исправлением — QA-TX2-ARCH.md; независимый review и финальный общий fullQA выполняются отдельно. До fullQA координатор сначала обновляет стенд.
Исходный общий прогон не перезапускался автором. Код больше не меняется; не коммитил, прод/секреты не трогал, карта обновлена.
