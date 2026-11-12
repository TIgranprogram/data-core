# C090 — full backend перед выпуском C089–C091
Статус PASS, 2026-11-12; исходный HEAD 73aff678, проверенные backend/src и backend/test не менялись во время прогона.
✅ Unit: 325/325 suites, 3803/3803 tests; e2e: 74/74 suites, 561/561 tests; все команды exit 0, fail 0, skip 0.
E2e запускались 10 последовательными группами по 8 файлов (последняя 1), затем отдельный test/reset-password.e2e-spec.ts (22); полный список Jest покрыт без дублей, OOM и повторов успешных тестов нет.
✅ C090 частичные оплаты обеих сводок и T26 атомарность склада (12 тестов) входят в полный PASS; T26 получил свежую отдельную disposable БД.
Изоляция: собственный Mongo4.4 c090-qa-mongo-20261112, том того же имени, только 127.0.0.1:27990, replicaSet c090; уникальные datacore-test-c090-* для групп и datacore-test-t26-* для T26.
Штатный env setup заменён одноразовым; fs.existsSync скрывает .env, fs.readFileSync запрещает чтение .env; JWT/ADMIN/MONGO заданы тестовыми значениями явно. Контейнер остановлен; 3102, Claude и прод не затронуты.
Команды: node node_modules/jest/bin/jest.js --runInBand --silent --setupFiles <isolated-env> --json --outputFile <unit.json>; e2e: node node_modules/jest/bin/jest.js --config <isolated-config> --runInBand --forceExit --runTestsByPath <группа> --json --outputFile <group.json>.
Evidence: evidence/full-results.json — безопасные результаты по группам и всем файлам; evidence/full-manifest-before.json — SHA256 каждого файла src/test; evidence/container-stopped.txt — остановка контура.
Manifest SHA256: 0c729f713bbab591ff1759a57f595db08e41d1de082814e053bb01604053de11; итоговая повторная сверка совпала, полный набор 74 e2e файлов покрыт.
➖ tsc повторно не запускался: ранее PASS исполнителя C090, координатор подтвердил отсутствие изменений src/test; штатный preflight перед выпуском остаётся обязательным. UI C089 и пульт C091 — отдельная приёмка.
Полные технические логи и одноразовая конфигурация оставлены вне репозитория в TEMP; TEST-LOG и карта qa обновлены; коммитов/выкладки нет.
