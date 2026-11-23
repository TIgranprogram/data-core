# Карта роли qa

коммит: 18ef2ec5 · опорная ревизия для поиска, 23.11.2026; финальный staged backend определяется SHA run05. Приёмка конкретного изменения фиксируется отдельно.

Открой ТЗ, эту карту и свою часть вывода `node backend/scripts/review-scope.mjs owners --staged`.
Границы и проверяющие заданы в [реестре](../ownership.json). Читай назначенный diff и только нужные функции или разделы по ссылкам ниже.

**Ответственность.** Критерии приёмки, корректность тестов и фикстур, риск регрессии на стыках, достоверность журнала. Для изменения выбери самую дешёвую проверку, которая действительно воспроизводит отказ.

- Серверный unit из `backend/`: `npx jest --runTestsByPath <путь-к-spec> --runInBand`. Клиентский Node-тест из корня: `node --experimental-vm-modules --test <путь-к-test.mjs>`. Серверные e2e — `backend/test/e2e/`, конфигурация — `backend/test/jest-e2e.json`.
- Перед e2e сверь выделенную одноразовую Mongo rs0 и допустимое имя БД в нужном тесте. Пример — `assertC170TestDatabase` в `backend/test/e2e/c170-passport-source.e2e-spec.ts`. Для сценариев файлов проверь изолированный каталог загрузок. Отсутствие подходящей среды фиксируй как SKIP с причиной.
- Для гонки, повтора запроса, старой записи или сбоя посередине тест должен наблюдать сохранённое состояние. Примеры проверок очереди — [C176](../../crew/C176-product-identification-queue/QA-REPORT.md), изоляции файловой очереди — [C169](../../crew/C169-local-document-intake/QA-REPORT.md).
- `docs/TEST-LOG.md` содержит итог общего прогона. Для адресной проверки достаточно команды, набора данных, количества прошедших/пропущенных тестов и результата в отчёте задачи.
- Владелец кода может добавить локальную регрессию. Новую постоянную блокировку передай архитектору с примерами пропуска и отказа. Визуальный вердикт по снимкам даёт дизайнер.

- C233: защита создания заказчика и подтверждения — `tools/document-intake/c233-customer-qa.test.mjs:38`; неполные текстовые таблицы — `tools/document-intake/c233-print-layout-qa.test.mjs:14`. Итоги и границы: [QA-REPORT](../../crew/C233-live-intake-control/QA-REPORT.md).
- C237: различие договора/заказа в PDF — `backend/src/modules/salesorders/production-orders.pdf.spec.ts:25`, генератор/default — `order-pdf.spec.ts:32` того же модуля; UI — `backend/pwa/sections/c237-contract-labels.test.mjs:20`. Изолированные Mongo-команды и ограничения: [QA-COMMANDS](../../crew/C237-contract-order-labels/QA-COMMANDS.md).
- C239: рисунки 8→9/повтор пятой привязки — `tools/document-intake/c239-images-qa.test.mjs:100`, `:122`; выбор договора без POST/N+1/100 headers — `:134`; UI-фикстура — `pult/test/ui-document-intake-images.fixture.mjs:1`. [QA и границы](../../crew/C239-intake-document-images/QA-REPORT.md).
- C240/C242: настоящие HTTP role/reset/scopes — `backend/test/e2e/c240-stock-views.e2e-spec.ts:38`; global paging/zero/cache — `backend/test/e2e/c242-stock-catalog-http.e2e-spec.ts:62`, `:131`. Оба запускаются на отдельной `datacore-test-c240-c242`; expected union — `docs/crew/C242-stock-section-order/qa/full-plan-union.json`.
- C241 P2: `backend/src/modules/product-passport/passport-inventor-installation-choice.spec.ts:191` и `backend/test/e2e/passport-import.e2e-spec.ts:482`, `:491`, `:496`; независимые40unit/34HTTP — [QA](../../crew/C241-inventor-installation-choice/QA-REPORT.md).

История карты до сокращения: `git show 3929ea33:docs/roles/maps/qa.md | rg -n 'слово|Cxxx'`. Подробные результаты остаются в отчётах задач.
- C236/240/241/242 full run02: `docs/crew/C236-trainer-exercise-instructions/qa/run02/run-full.ps1:1`; exact111-suite union и источникSHA — `run02/full-summary.json:1`; QA HTTP stale single→multiple no-write — `backend/test/e2e/c242-stock-catalog-http.e2e-spec.ts:62`. Полный FAIL stockscope не скрывать: `backend/test/e2e/stock-scope.e2e-spec.ts:160`, `:180`, `:229`, `:251`. Карта обновлена, коммит:36bdd4dc.
- C242 SM6 контракт существующих нулей — `backend/test/e2e/stock-scope.e2e-spec.ts:190`; адресный beforeAll-timeout не считать приёмкой assertions: `docs/crew/C236-trainer-exercise-instructions/qa/SM6-REPORT.md:1`. Карта обновлена, коммит:36bdd4dc.
- C236 release run04: Swagger real-schema — `backend/src/modules/role/stock-views.swagger.spec.ts:1`; порядок/блокировки orchestration — `docs/crew/C236-trainer-exercise-instructions/qa/run04/run-release.ps1:1`; Гант timeout сохранять как FAIL до причины — `backend/test/e2e/order-line-plan.e2e-spec.ts:100`. Карта обновлена, коммит:18ef2ec5 (опорный HEAD; staged runtime определяется SHA).

- C236/240/241/242 FINAL run05 ✅405unit suites/4167tests +111e2e suites/914tests: `docs/crew/C236-trainer-exercise-instructions/qa/QA-REPORT.md:1`, точныйunion/SHA/T26setuphistory — `qa/run05/full-summary.json:1`; finalsourceSHA — `qa/run05/final-source-sha256.json:1`; uniqueT26driver — `qa/run05/run-full.ps1:1`. Runtime regression anchors: `backend/src/modules/order-line-plan/work-schedule-session.spec.ts:1`; count HTTP no-write — `backend/test/e2e/c242-stock-catalog-http.e2e-spec.ts:62`; SM6 — `backend/test/e2e/stock-scope.e2e-spec.ts:190`. Карта обновлена, коммит:18ef2ec5, финальная source-истина — SHA, не staging.
