# C161 — итог QA серверной части, 19.11.2026

Статус **BACKEND + PWA SMOKE PASS; визуальная приёмка отдельно**. Проверен C158+C161 freeze, base179c6239; prod/credentials/массовая реорганизация не затрагивались.
✅ Full unit359 suites/3685 tests PASS,skip0; tsc/Nest build0. Исходные JSON/log/run UTC и SHA manifest сохранены с начала.
Raw full e2e:79 PASS/4 FAIL/1 SKIP suites;639 PASS/6 FAIL/12 SKIP tests,522.563с,exit1. Результат не переписан и не называется единым full PASS.
✅ После адресного исправления только фикстур: chain-payment-form+C158QA8/8 PASS; finance+salesorders17/17 PASS. Объединённое покрытие штатного набора83 suites/645 tests PASS,0 FAIL; T26 opt-in1 suite/12tests SKIP по согласованию. Повтора всего full не было.
Фикстуры: настоящие3 selectable статьи вместо несуществующихID; DELETE доходит до проверки суммы с expectedPaymentId/version; старый synthetic paidDate снимается явным paidDate:'', не заменой массива. Денежные/receipt/корзина assertions сохранены, защитные409 усилены.
✅ Новые QA2: materialize replay после correction/source version не создаёт ID/audit повторно; ledger/income/expense после correction+rename/reparent/archive сходятся в operations/articles/calendar/summary и всех страницах. Core18/tree9 также прошли full.
✅ C158 инварианты дат, копеек, CAS rollback, истории, scope и legacy сохранены. Выявленный стык UI orders payments:[] передан frontend; API guard не ослаблялся.
Manifest1679 files: backend/src/admin без изменений; во время full согласованно изменены8 PWA-файлов, итог11 PWA+4 fixture-файла. Финальный smoke QA:350/350 guards,355 imports/0 ошибок; frontend69node/design0 по отчёту роли. SHA final3a2efe08…; полный backend не повторялся.
ESLint5 изменённых QA/e2e файлов0. Evidence/QA-RESULTS.json содержит команды/UTC/exitCode/SHA raw JSON/log и честный merged coverage; qa-manifest-before/after-full/after-targets отдельно.
➖ Визуальная приёмка/релиз и применение ARTICLE-PLAN183 — отдельные ворота координатора, не доказаны автотестами. Pre-final359/3684+ABORTED и C158 raw FAIL не перезаписаны.
Карта QA и TEST-LOG обновлены; общий полный прогон после UI-only правок не заявлен. Visual/designer PASS этим отчётом не присваивается.
