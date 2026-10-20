# backend/ — NestJS API data-core

Вход для агентов — [../AGENTS.md](../AGENTS.md). Карта модулей — [../docs/MAP.md](../docs/MAP.md), устройство — [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md).

```bash
npx tsc --noEmit                 # типы
npx jest --silent                # юнит
npx jest --config ./test/jest-e2e.json --runInBand --forceExit   # e2e (нужен Mongo rs0)
npx nest build                   # сборка → dist/src/main.js
```

Конфиг — через env (`src/config/configuration.ts`, валидация `src/config/env.validation.ts`). В Docker env берётся из корневого `.env`; `backend/.env.example` — для запуска без Docker.

Безопасность (кратко): в `NODE_ENV=production` процесс не стартует со слабыми секретами (`src/config/secret-validation.service.ts`: JWT-секреты ≥32 и разные, `ADMIN_PASSWORD` ≥12, не демо-дефолт). Генерация секрета: `openssl rand -hex 32`. Swagger в prod выключен (`SWAGGER_ENABLED=true` — включить). `DISABLE_THROTTLE` в prod запрещён.
