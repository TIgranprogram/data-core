# QA C236/240/241/242 — промежуточно
FAIL | unit ✅401 suites/4135 tests; tsc/eslint ✅exit0; e2e ❌полный union не завершён.
HTTP C236/C241/C170 ✅3 suites/74 tests; обычная batch1 ✅26/293; batch2 ❌25 suites PASS/1 FAIL, 181 tests PASS/4 FAIL.
Дефект: POST /api/passports → create → snapshot: новый черновик без установки возвращает409 вместо201 (products-order.e2e-spec.ts:39,73,93; service.ts:958).
JSON: full-unit.json, full-e2e-c172.json, full-e2e-batch-1.json, full-e2e-batch-2.json; полный stdout — tools/logs/c236-release-*.log.
Адресный diagnostic: products-order-diagnostic.json (1 FAIL,8 не выбранных -t); body и первый stack сохранены, ожидание201 не ослаблено.
До исправления batch3/4 и оставшиеся специальные группы не запускались; 55/111 suites проверено,54 PASS/1 FAIL,56 ещё не выполнены.
Owned Mongo datacore-c236-qa-mongo retained: loopback27237, rs0, task=C236/ephemeral=true; prod и живые volumes не использованы.
Команды/манифесты: full-plan.json, full-e2e-batch-*-list.json, full-interim-summary.json; NODE_OPTIONS=--max-old-space-size=6144.
UI ➖этим backend-прогоном не принимается; runtime передан автору, повтор зелёных наборов приостановлен координатором.
