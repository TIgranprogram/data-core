# C090 — QA
Статус: PASS целевого e2e, 2026-11-12, HEAD f669a462 + текущие изменения C090.
✅ Частичная 300/1000, полная, старая полная без paidAmount, приоритет paidDate, неоплаченная и null: проверены реальными фикстурами через оба HTTP списка.
✅ Удалённые и отменённые позиции исключены; публичные amount/paidAmount/lineCount проверены.
Тест: backend/test/e2e/salesorders.e2e-spec.ts:145; обе сводки: salesorders.service.ts:63 и production-orders.service.ts:162.
Команда из backend: npx jest --config ../docs/crew/C090-small-fixes/evidence/jest-isolated.json --runInBand --forceExit --runTestsByPath test/e2e/salesorders.e2e-spec.ts test/e2e/production-orders.e2e-spec.ts --json --outputFile ../docs/crew/C090-small-fixes/evidence/e2e-results.json
Результат: exit 0, 2/2 suites, 13/13 tests, skip 0; evidence/e2e.log. Одноразовые config/setup и подробный JSON после проверки удалены.
Изоляция: mongo:4.4, c090-qa-mongo-20261112, уникальный том, 127.0.0.1:27990, replicaSet c090, БД datacore-test-c090; контейнер остановлен (evidence/container-stopped.txt).
Штатный setup читает .env безусловно; одноразовый config заменяет setup, скрывает .env от existsSync и запрещает readFileSync. Тестовые JWT/ADMIN/MONGO заданы явно.
Два технических старта: LOG_LEVEL=silent отклонён валидацией; затем отсутствовал MONGO_REPLICA_SET=c090. Исправлено в одноразовом setup, подробные технические логи после проверки удалены; продуктовых дефектов не обнаружено.
➖ Full, UI и релиз не выполнялись; tsc/unit — область исполнителя. C069/дневной отчёт — область координатора.

