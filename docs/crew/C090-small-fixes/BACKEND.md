# C090 — backend
Статус: реализация завершена; e2e передан QA для отдельного MongoDB 4.4.
ТЗ 1–2 ✅: paidDate → amount; иначе paidAmount ?? 0 в обеих сводках; фильтры и публичные поля сохранены.
ТЗ 3 ✅ подготовлен: 8 e2e-фикстур × 2 маршрута (частичная, полная, старая полная, приоритет даты, без оплаты, null, удалённая, отменённая).
До: частичная 300/1000 давала 0; после: 300. Число запросов не изменилось, измерение времени API не выполнялось.
Файлы: salesorders.service.ts:63; production-orders.service.ts:162; test/e2e/salesorders.e2e-spec.ts:145.
ТЗ 4 ✅: `npx tsc --noEmit` — exit 0; `npx jest src/modules/salesorders --silent --runInBand` — exit 0, 7 suites / 37 tests.
`npx eslint "src/modules/salesorders/**/*.ts" test/e2e/salesorders.e2e-spec.ts` — exit 0, e2e по умолчанию игнорируется.
`npx eslint --no-ignore test/e2e/salesorders.e2e-spec.ts` — exit 0.
E2e: результат отдельного прогона фиксирует QA; здесь не запускался, секреты и живые БД не читались.
Карта обновлена; коммит: — (не выполнялся). Контракт/схемы/маршруты не менялись, MAP/openapi не требуют обновления.
