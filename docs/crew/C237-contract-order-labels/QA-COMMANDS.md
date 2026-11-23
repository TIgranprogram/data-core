# C237 — команды независимой QA

Выполнялись из `backend/`; секретные файлы не открывались. Штатный `test/setup/jest-e2e-env.ts` сам подготавливал окружение общего прогона. Рабочий сайт не участвовал.

Общий unit:
```powershell
$env:NODE_OPTIONS = '--max-old-space-size=6144'
npx jest --silent --runInBand --json --outputFile=../docs/crew/C237-contract-order-labels/qa/unit-results.json
```

Исходный общий e2e на локальном Docker MongoDB `:27018`:
```powershell
$env:NODE_OPTIONS = '--max-old-space-size=6144'
$env:MONGO_DB_TEST = 'datacore-test-c237'
npx jest --config ./test/jest-e2e.json --runInBand --forceExit --silent --json --outputFile=../docs/crew/C237-contract-order-labels/qa/e2e-results.json
```

Изолированная MongoDB для несовместимых с портом/именем общих тестов: новый контейнер, без bind mounts и именованных томов. Доступ с хоста только loopback, авторизация выключена только на этой одноразовой копии. Labels подтверждены `docker inspect`; перед запуском имя контейнера и порт свободны.
```powershell
docker run -d --name datacore-c237-qa-mongo --label datacore.owner=codex --label datacore.task=C237 --label datacore.ephemeral=true --publish 127.0.0.1:27237:27017 mongo:4.4 --replSet rs0 --bind_ip_all
docker exec datacore-c237-qa-mongo mongo --quiet --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"localhost:27017"}]})'
```

Адресные повторы — последовательными процессами, без изменения guards/тайм-аутов. В каждом процессе:
```powershell
$env:NODE_OPTIONS = '--max-old-space-size=6144'
$env:MONGO_PORT = '27237'
$env:MONGO_URI = 'mongodb://127.0.0.1:27237/x?replicaSet=rs0&directConnection=true'
$env:MONGO_DB_TEST = '<имя из таблицы>'
$env:MONGO_DB = $env:MONGO_DB_TEST
npx jest --config ./test/jest-e2e.json --runInBand --forceExit --silent --json --outputFile=../docs/crew/C237-contract-order-labels/qa/<результат>.json --runTestsByPath <пути из таблицы>
```

| Имя БД | Пути после `test/e2e/` | Результат | Лог в `tools/logs/` |
|---|---|---|---|
| `datacore-test-c172-release` | `c170-passport-source.e2e-spec.ts passport-import.e2e-spec.ts` | `e2e-c170-c172` | `c237-e2e-c170-c172.log` |
| `datacore-test-c237` | `c188-order-archive.e2e-spec.ts` | `e2e-c188` | `c237-e2e-c188.log` |
| `datacore-test-c198-acts` | `c198-order-acts.e2e-spec.ts` | `e2e-c198` | `c237-e2e-c198.log` |
| `datacore-test-c237` | `stock-scope.e2e-spec.ts` | `e2e-stock-scope` | `c237-e2e-stock-scope.log` |

Общие guards не ослаблялись: C170/C172 ограничивают имена, C188 запрещает общий порт `27018`, C198 требует своё имя и изолированный порт. Только отдельная MongoDB удовлетворяет всем этим ограничениям без обхода защиты.

## Восстановление доказанного полного охвата после OOM

Монолитный общий процесс завершился `JavaScript heap out of memory`, exit 1; итоговый JSON не записан. Его неполный stdout не считается доказательством полного прохождения. Сводка сохранённых ошибок: `tools/logs/c237-e2e-monolithic-failure.log`.

Из `qa/e2e-suite-list.json` (109 путей) исключены пять уже подтверждённых изолированных suites таблицы выше. Остальные 104 разделены на четыре манифеста `qa/e2e-batch-N-list.json` по 26 путей. Они запускаются **последовательно между процессами** на той же одноразовой MongoDB `127.0.0.1:27237`, БД `datacore-test-c237`. Каждый процесс использует тот же `NODE_OPTIONS=--max-old-space-size=6144`, `--runInBand --forceExit --silent --json`, `--outputFile=../docs/crew/C237-contract-order-labels/qa/e2e-batch-N.json` и `--runTestsByPath` с путями своего манифеста. Stdout/stderr перенаправлены в `tools/logs/c237-e2e-batch-N.log`; после каждого процесса фиксируются exit и JSON-счётчики.

Урок QA: общий e2e с большим числом Nest-контекстов завершает лимит памяти одного процесса. Полноту доказывают JSON коротких последовательных процессов; исходный OOM остаётся отдельным FAIL и не переименовывается в PASS.

## T26 и окончательная сверка

Общий режим штатно пропустил T26 (12 tests), поскольку это opt-in. Координатор явно выдал URI только для своей одноразовой MongoDB; перед запуском повторно проверены labels `datacore.task=C237` и `datacore.ephemeral=true`:
```powershell
$env:STOCK_CATALOG_TEST_DISPOSABLE = '1'
$env:STOCK_CATALOG_TEST_URI = 'mongodb://127.0.0.1:27237/datacore-test-t26-c237?replicaSet=rs0&directConnection=true'
$env:MONGO_DB_TEST = 'datacore-test-t26-c237'
$env:MONGO_DB = 'datacore-test-t26-c237'
$env:MONGO_URI = $env:STOCK_CATALOG_TEST_URI
npx jest --config ./test/jest-e2e.json --runInBand --forceExit --silent --json --outputFile=../docs/crew/C237-contract-order-labels/qa/e2e-t26.json --runTestsByPath test/e2e/stock-catalog-atomicity.e2e-spec.ts
```

T26 завершился 12/12 PASS. `qa/summary.json` объединяет девять успешных отчётов; skipped T26 из четвёртой пачки заменён отдельным успешным результатом того же пути. Покрытие сверено с исходными 109 путями: 109 наборов и 884 tests PASS, без missing/failed/pending. Итог не включает неполный монолитный процесс в качестве доказательства.

После сохранения результатов проверены owner/task/ephemeral labels, отсутствие bind mounts и loopback port binding `27237`; затем выполнено `docker rm -f -v datacore-c237-qa-mongo`. Удалён только созданный QA контейнер и его анонимные временные тома. Существующие контейнеры, данные и файлы uploads не удалялись.
