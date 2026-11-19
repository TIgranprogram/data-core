Статус: C162 CORE готов к адресной архитектурной и общей QA-приёмке; runtime заморожен, production не выпускался.
✅ Income: серверные paymentId, protected writes/company, metadata-only identity-plan/materialize с CAS/retry/mapping; synthetic paidDate без нового денежного факта.
✅ Canonical operations/detail: source-qualified ID, bounded date/company/source, полные totals до page≤100; recursive BOTH articleRows, dynamic months, сохранены incomeRows/object scope/contractPrice/pct.
✅ Typed classification: единый pure resolver, original/override/history, reason/CAS/retry/reset, archive-original reset, legacy→ledger carry+alias в одной транзакции; payroll по реальному payout _id.
✅ ARCH1: source cancel/remove/move/restore CAS; forced cancel/remove vs payment; paid legacy sourcePATCH409 в том числе header/snapshot paid при row.paid=false; Moscow00:30; payroll source section; old archived income part сохраняется.
✅ Новая source auto-default архивной/групповой статьи: платёж сохраняется с articleId=null и warning; явный недоступный выбор400, старые allocation/original сохраняются; session referenceGuard.
Файлы: common/financial-classification; modules/{finance,incomes,expenses,supply,payroll}; test/e2e/financial-operations.e2e-spec.ts; точные якоря — docs/roles/maps/backend.md.
Проверки: tsc0; eslint0; cycles0; 17 suites/333 unit PASS8.741s; 1 suite/18 e2e PASS13.659s; адресные4 suites/182unit PASS6.155s после двух финальных исправлений. Evidence: core-unit-final.json/core-unit-two-fixes.json/core-e2e-two-fixes-pass.json; raw tools/logs/c159-core-{unit-final,unit-two-fixes,e2e-two-fixes-pass}.log.
Измерение HTTP pipeline:7 фактов/page2=33.64ms;120 выбранных+900 чужой company/date+40history/факт,page2=17.97ms; totals7260, history отсутствует list и40 записей доступны detail. Это локальный замер, не SLA.
Риски: старый календарь/summary сохраняет прежний более широкий payroll набор; новый canonical явно excludedSources/totalsScope и source payroll section. Каскад Stock/workTask теперь в одной внешней session с income; forced precommit throw откатывает все4 сущности, retry снимает бронь ровно один раз.
Нужно от других: адресный ARCH review, полный QA/C158 regression, UI/API приёмка, общий MAP/OpenAPI/выпуск координатором; загрузка счетов только после выпуска. Массовый ARTICLE-PLAN не применялся.
коммит: — (по поручению не выполнялся); карта обновлена.
