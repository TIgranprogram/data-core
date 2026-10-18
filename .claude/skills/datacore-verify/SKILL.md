---
name: datacore-verify
description: Проверка изменений в data-core — typecheck, юнит, eslint, e2e, live-smoke через Docker, перегенерация openapi.json. Использовать после любой правки backend/ или admin/ и перед тем, как сказать «готово».
---

# Проверка изменений (data-core)

Работай из `backend/`. pnpm может отсутствовать в PATH → `npx`. Долгие команды — в фоне.

## 1. Всегда (дёшево)

```bash
npx tsc --noEmit            # норма: exit 0
npx jest --silent           # норма: все suites passed (база 68/736 на 2026-10-18)
npx eslint "src/**/*.ts"    # норма: 0 errors (warnings no-explicit-any допустимы)
```

Точечно: `npx jest src/modules/<m>` — только тесты модуля.

## 2. Если менял маршруты/DTO/guards — e2e

Нужен живой Mongo rs0 (Docker Desktop запущен, `docker compose up -d` из корня).
- Харнесс `test/setup/test-db.ts` берёт `MONGO_URI`, **подменяет имя БД на `MONGO_DB_TEST` (умолч. `datacore-test`) и дропает там все коллекции**. Никогда не ставь `MONGO_DB_TEST=datacore`.
- Пользователь `datacore` имеет права только на БД `datacore` → для e2e нужен URI с root: `mongodb://root:<MONGO_ROOT_PASSWORD>@localhost:<MONGO_PORT>/x?replicaSet=rs0&directConnection=true&authSource=admin` (пароль из корневого `.env`, в чат не выводить).
```bash
MONGO_URI='...' npx jest --config ./test/jest-e2e.json --runInBand --forceExit
```
Норма: все suites passed (база 20 suites / 147 tests).
Если в `backend/` нет `.env` (например, в git worktree), `ConfigModule` падает ещё при импорте `AppModule` — передай тестовые `JWT_SECRET`, `JWT_REFRESH_SECRET` (≥16 символов) и `ADMIN_PASSWORD=admin123456` прямо в команде.

## 3. Live-smoke (если менял рантайм/админку)

```bash
docker compose up -d --build backend        # из корня
curl -sf http://localhost:3001/api/health/ready
```
Логин: `POST /api/auth/login` (лимит 5/мин — не долби). Админка: `http://localhost:3001/admin` (правки `backend/admin/` видны без пересборки — смонтирован том). Браузерная проверка — встроенный браузер.
Деструктивные действия на живой БД (`datacore`) — **запрещены** без «да» пользователя.

> Добавил `import` нового пакета или менял `main.ts`/Dockerfile → обязательно `docker compose build backend` + health: тесты не ловят отсутствующие в prod-образе зависимости.

## 4. Если изменился контракт API — openapi

```bash
docker compose exec backend node dist/src/export-openapi.js /app/openapi.json
docker compose cp backend:/app/openapi.json docs/openapi.json
```
(образ должен быть пересобран с изменением). Затем skill `datacore-docs-sync`.

## Отчёт

Пиши фактические числа (suites/tests, exit-коды). Не удалось прогнать (нет Docker) — так и скажи, не выдавай за пройденное.
