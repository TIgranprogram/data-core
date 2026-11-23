# Независимая QA C236/240/241/242 — run02
FAIL | ✅402 unit suites/4156 tests; tsc0/ESLint0(45 TS); ❌e2e110/111 suites,910/914 tests,4 FAIL.
✅111/111 expected suites фактически выполнены,0 skipped/missing/extra/duplicates; SHA всех src/test TS после прогона совпадает.
✅Новый C242 direct/batch count: HTTP single→multiple409, обе ячейки/материал/ledger без изменений; отдельный8/8 и полный strict14/14 PASS.
✅C236/C241/C170 реальные HTTP3 suites/74tests; прежняя create→snapshot409 регрессия исправлена, products-order теперь9/9 PASS с201.
❌stock-scope.e2e-spec.ts:160,180 — correct() два штатных60s timeout; ожидания/таймаут не менялись.
❌stock-scope.e2e-spec.ts:229,251 — старое требование скрывать нулевой металл против C242 zero-catalog; передано координатору, assertions пока сохранены.
Команды и группы: run02/run-full.ps1; JSON+union: run02/full-summary.json; полный stdout: tools/logs/c236-run02-*.log.
Изоляция: owned mongo4.4 rs0 loopback27237, labels task=C236/ephemeral=true; строгие DB сохранены, prod/живыеvolumes/секреты не трогали.
Предыдущий FAIL-run и products-order-diagnostic.json сохранены отдельно. Mongo оставлен для расследования; полный PASS не объявлен.
➖UI C236/C242 и настоящий Inventor этим backend-прогоном не принимаются; first-print audit metadata поведение из BACKEND-REPORT не скрывается.

