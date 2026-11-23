# SM6 — актуализация контракта C242
PARTIAL | ✅test-only: admin/free role видят нули items/lookup/categories(total2), held1/availability=in исключают нули; scoped точный набор без чужого крепежа.
Файл: backend/test/e2e/stock-scope.e2e-spec.ts:190; correct() и таймаут60s не менялись, ESLint0.
❌Адресный -t СМ.6: beforeAll createTestApp() timeout60000,3FAILhook/11невыбранных; assertions ещё не достигнуты.
Доказательства: run02/sm6-contract.json и tools/logs/c236-run02-sm6-contract.log; прежний полный FAIL сохранён.
Изоляция: owned27237/datacore-test-c240-c242, автор correct использует отдельнуюdatacore-test-c242-correct.
Нужно: после runtime freeze разрешённый повтор всегоstockscope на свежейtest-БД; полный PASS пока запрещён.
