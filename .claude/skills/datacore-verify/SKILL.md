---
name: datacore-verify
description: Проверка изменений в data-core — typecheck, юнит, eslint, e2e, live-smoke через Docker, перегенерация openapi.json. Использовать после любой правки backend/ или admin/ и перед тем, как сказать «готово».
---

# Проверка изменений (data-core)

Работай из `backend/`. pnpm может отсутствовать в PATH → `npx`. Долгие команды — в фоне.

## 0. Сколько проверять — сначала это (экономия токенов, правило пользователя 2026-10-20)

| Что поменялось | Проверка |
|--|--|
| только `backend/pwa/**`, `backend/admin/**` | `node --check --input-type=module < файл` для изменённых; QA **не пересобирать** (pwa/admin смонтированы папками); снимок — **только по просьбе пользователя** (или спросить разрешения) |
| `backend/src/**` (одна область) | `npx tsc --noEmit` + `npx jest src/modules/<модуль> --silent`; e2e — только своего файла |
| перед выкладкой | полный юнит + e2e — **только если** с последней записи в `docs/TEST-LOG.md` менялся `backend/src` или `backend/test`; после прогона — строка в журнал |
| только доки | ничего |

Пересборка QA — только при изменении `backend/src`. Длинные прогоны и разбор падений можно отдать агенту `model: "haiku"`.

## 1. Всегда (дёшево)

```bash
npx tsc --noEmit            # норма: exit 0
npx jest --silent           # норма: все suites passed (база 70/748 на 2026-10-18)
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
Норма: все suites passed (база 23 suites / 173 tests на 2026-10-19).
Если в `backend/` нет `.env` (например, в git worktree), `ConfigModule` падает ещё при импорте `AppModule` — передай тестовые `JWT_SECRET`, `JWT_REFRESH_SECRET` (≥16 символов) и `ADMIN_PASSWORD=admin123456` прямо в команде.

## 3. Live-smoke (если менял рантайм/админку)

```bash
docker compose up -d --build backend        # из корня
curl -sf http://localhost:3001/api/health/ready
```
Логин: `POST /api/auth/login` (лимит 5/мин — не долби). Админка: `http://localhost:3001/admin` (правки `backend/admin/` видны без пересборки — смонтирован том). Браузерная проверка — встроенный браузер.
Деструктивные действия на живой БД (`datacore`) — **запрещены** без «да» пользователя.

> Добавил `import` нового пакета или менял `main.ts`/Dockerfile → обязательно `docker compose build backend` + health: тесты не ловят отсутствующие в prod-образе зависимости.

## 3а. Стенд на копии прод-данных (обязателен для проверки приложения, CANON §6)

Проверять интерфейс на пустой базе нельзя — только на копии реальных данных. Рабочую БД `datacore` не трогаем: копия живёт в отдельной БД `datacoreqa`.
1. Свежий бэкап — `D:\datacore-backups\datacore-<дата>.tgz` (тянется с VM каждую ночь). Распаковать в scratchpad (`tar --force-local -xzf …`).
2. `docker cp <распаковано>/mongo-*/datacore datacore-mongo:/tmp/prod-dump`, затем в контейнере от root (переменные контейнера, пароль не печатать): `mongorestore --db datacoreqa /tmp/prod-dump` (БД новая — `--drop` не нужен; если `datacoreqa` уже есть и нужна свежая — сначала спросить пользователя).
3. Один раз: Mongo-пользователь `datacoreqa` (readWrite только на `datacoreqa`), пароль сгенерировать и держать в scratchpad.
4. `QA_MONGO_PW=… docker compose -f docker-compose.yml -f docker-compose.qa.yml up -d --build backend-qa` → `http://localhost:3002/app/`. Код поменял — `build backend-qa` + `up -d --no-deps --force-recreate backend-qa` (без этого контейнер может остаться старым).
5. Вход: тестовый пользователь в `datacoreqa.users` (bcryptjs-хеш из контейнера: `node -e "console.log(require('bcryptjs').hashSync(pw,10))"`), пароль генерируется, в чат не выводится. Для входа пользователя на стенд (решение пользователя 2026-10-22): пользователь `admin` с простым паролем, который знает пользователь (в репо не писать), в `datacoreqa.users` — после свежего восстановления копии выставить заново (только на `datacoreqa`, не на `datacore`).

6. Снимки на разных ширинах (CANON §2 — 1920, 2560, 1024, 390): `QA_DIR=<scratchpad с qa-login.txt> node backend/scripts/qa-screenshot.mjs 1920 1080 '#requests?view=board' out.png` → открыть png и посмотреть. Встроенный браузер шире своей панели показывает неправильно — для широких экранов только так.

e2e без root-пароля: Mongo-пользователь `datacoretest` (readWrite только на `datacore-test`) и `MONGO_URI=mongodb://datacoretest:<pw>@localhost:27018/datacore-test?authSource=admin&replicaSet=rs0&directConnection=true` + тестовые `JWT_SECRET`/`JWT_REFRESH_SECRET`/`ADMIN_PASSWORD` в команде.

## 4. Если изменился контракт API — openapi

```bash
docker compose exec backend node dist/src/export-openapi.js /app/openapi.json
docker compose cp backend:/app/openapi.json docs/openapi.json
```
(образ должен быть пересобран с изменением). Затем skill `datacore-docs-sync`.

## Отчёт

Пиши фактические числа (suites/tests, exit-коды). Не удалось прогнать (нет Docker) — так и скажи, не выдавай за пройденное.
