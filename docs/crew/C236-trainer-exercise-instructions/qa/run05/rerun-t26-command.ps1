# Единственный разрешённый fixture-retry T26; historical FAIL сохранён, старую БД не чистили.
$env:NODE_OPTIONS='--max-old-space-size=6144'
$env:MONGO_DB_TEST='datacore-test-t26-c236-run05';$env:MONGO_DB=$env:MONGO_DB_TEST;$env:MONGO_PORT='27237'
$env:MONGO_URI='mongodb://127.0.0.1:27237/x?replicaSet=rs0&directConnection=true'
$env:STOCK_CATALOG_TEST_DISPOSABLE='1'
$env:STOCK_CATALOG_TEST_URI='mongodb://127.0.0.1:27237/datacore-test-t26-c236-run05?replicaSet=rs0&directConnection=true'
Push-Location backend
try { npx jest --config ./test/jest-e2e.json --runInBand --forceExit --silent --json --outputFile=../docs/crew/C236-trainer-exercise-instructions/qa/run05/t26.json --runTestsByPath test/e2e/stock-catalog-atomicity.e2e-spec.ts *> ../tools/logs/c236-run05-t26-fresh.log } finally {Pop-Location}
