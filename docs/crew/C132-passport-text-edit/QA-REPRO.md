# Повтор QA C132

Edge/CDP работал с PWA на loopback 31332. Прокси передавал API в локальный тестовый AppModule на 31333. Данные заполнялись заново в изолированной Docker Mongo 4.4, replica set c132, loopback 27232. Серверный live bootstrap проверяет имя datacore-test-c132-live перед очисткой.

Локальные материалы хранятся в ignored tools/logs: c132-live.ts, c132-visual.mjs, c132-isolated-env.cjs и профили Edge. Для повторения скопировать c132-live.ts в backend/test, выставить TS_NODE_FILES=true, из backend запустить:

```powershell
node -r ../tools/logs/c132-isolated-env.cjs -r ts-node/register -e "process.env.MONGO_DB_TEST='datacore-test-c132-live'; process.env.MONGO_DB=process.env.MONGO_DB_TEST; process.env.MONGO_URI=process.env.MONGO_URI.replace('/datacore-test-c132?', '/datacore-test-c132-live?'); require('./test/c132-live.ts')"
```

Из корня `node tools/logs/c132-visual.mjs` повторяет все сценарии. Опция `--picker-only` проверяет выбор клавиатурой, название, подтверждение и отмену на телефоне в обеих темах. Full использовал `NODE_OPTIONS=--max-old-space-size=6144`, preload c132-isolated-env.cjs и четыре непересекающиеся группы файлов из JSON. Прокси фиксирует только метод, маршрут и статус. Для конфликта он передаёт реальную вторую запись в тестовую БД между target и promote.
