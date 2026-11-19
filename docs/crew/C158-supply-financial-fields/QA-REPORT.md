# C158 — закрытие адресной QA, 19.11.2026

Статус **исправления C158 приняты адресно; общий выпуск PARTIAL до C161 full/UI**. Новый прогон на движущемся C161 не запускался; прод/БД не проверялись.
✅ Собственный raw full unit ДО финальных fixes:355 suites/3648 tests PASS,72.759с; tsc/build0; lint5 изменённых e2e0. Это не full на итоговом C161.
Raw full e2e ДО fixes:76 PASS/4 FAIL/1 SKIP suites;595 PASS/10 FAIL/12 SKIP tests,508.106с. Первый targeted retry:3 PASS/3 FAIL suites,48 PASS/2 FAIL tests +compile; исходные результаты сохранены.
✅ Финальный адресный пакет backend:6 suites/71 tests PASS,47.835с; unit14/258,tsc/lint/cycles0 — evidence/backend-final-targeted.json и tool-output.txt сверены: команда,6PASS paths,71/47.835с,exit0,session36504/chunks7f7f5e/e63490 совпадают. Это сохранённая копия tool result, не raw лог с начала; не новый full PASS.
✅ Проверен test diff: три payer-фикстуры используют настоящую isOurCompany; ledger freeze409 усилен; receipt/legacy assertions не сняты. T24 стал issued/unpaid, но barrier, receiptBoundary,price75/qty1/received1,непривязанный added и amount75 сохранены.
✅ T27 задаёт исторический POSTpayments вместо raw paidAt; явный RUB override меняет обязательство150, ledger/cashflow100 остаются; addRequests409 и отсутствие привязки закреплены, соседний legacy snapshot тест сохранён.
✅ Два QA-дефекта закрыты кодом/регрессиями: invoice_paid callback внутри payment transaction только при full переходе, partial/replay/void без дубля; addRequests после факта409. Не ослаблялись ожидания количества истории цен.
✅ Дополнительные проверки: четыре валютыUSD/EUR/CNY/UE, CAS при смене currency/payer безversion→409/0facts, legacy reconciliation вместо ложного долга; свои3QA (lateCAS rollback/retry,копейки/createdAt,voiddryrun/repeat) сохранены в71.
➖ T26 opt-in1 suite/12tests штатно SKIP по согласованию; URI не выдавался. Визуальная приёмка/latency отдельно; полный финальный unit/e2e нужен ПОСЛЕ C161 на фиксированном manifest с raw логами.
Артефакты: QA-PLAN.md, evidence/QA-RESULTS.json, backend-final-targeted.json; TEST-LOG и карта обновлены. Рабочий код и тесты в этом закрывающем review QA не менял.
