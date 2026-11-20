# C170 FIX2 — explicit unset в повторе transaction
Статус: единственный остаток второго review исправлен; backend FREEZE.
✅ `product-passport.service.ts:632` сохраняет пути doc.getChanges().$unset до toObject; `:637` применяет undefined на каждом новом hydrate attempt. Общий prepared BSON snapshot, номера и прочая логика не менялись.
✅ RealMongo: legacy draft PATCH incomeId:null, первый save→abort-before-commit, retry→документ отвязан и creationScopeKey физически отсутствует; новая draft старой позиции успешно занимает тот же unique lineScopeKey; старый detached документ остаётся.
Проверки: tsc --noEmit --incremental false0; update unit2suites/28PASS5.284s; targeted C170 FIX2 e2e1PASS/23SKIP12.372s, только owned51796/datacore-test-c170; eslint сервиса0.
Файлы: backend/src/modules/product-passport/product-passport.service.ts; backend/test/e2e/c170-passport-source.e2e-spec.ts. Остальные23e2e не перепрогонялись: предыдущий FIX23/23PASS12.345s сохранён как предыдущий результат, не новый full.
Коммит: не выполнялся; карта обновлена. Нужно от координатора: итоговая приёмка остатка и дальнейший QA.
