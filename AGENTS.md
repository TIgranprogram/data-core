# AGENTS.md — вход для ИИ-агента (читать первым)

> Цель файла: агент понимает проект **без чтения всего репо**. Читай по необходимости только то, на что указывает этот файл.
> Язык проекта — русский (доки, коммиты, комментарии к новому коду). Пользователь — не разработчик: отвечай коротко, по делу.

## Что это

**Personal Data Core** — личное ядро данных: MongoDB (rs0) + REST API на NestJS 10 / Mongoose 8. Данные живут здесь, клиенты (таблицы, скрипты, приложения, ИИ-агенты) ходят **только через API** по JWT или машинному ключу `kppd_…`. Бэкенд вынесен из старого проекта **kppdf-8.0** (CRM) и вычищен до 37 модулей: платформенное ядро + канонические справочники.

## Карта документации (что читать под задачу)

| Задача | Читай | Не читай |
|--|--|--|
| Любая работа с кодом | [docs/MAP.md](docs/MAP.md) — модуль → маршруты → коллекции → файлы | весь `backend/src` подряд |
| Как устроен запрос, auth, RBAC, плагины | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | — |
| Поля сущностей | [docs/data-model.md](docs/data-model.md) (ориентир), истина — `*.schema.ts` | — |
| Точный контракт эндпоинта | `docs/openapi.json` — **только grep по пути**, файл 175 КБ | целиком |
| Что делать / открытые задачи | [docs/TASKS.md](docs/TASKS.md) (бэклог), [ROADMAP.md](ROADMAP.md) (план) | — |
| Подключение внешних клиентов | [docs/CONNECT.md](docs/CONNECT.md) | — |
| Зачем проект, принципы | [VISION.md](VISION.md) | — |
| Что уже сделано и как проверялось | [docs/HISTORY.md](docs/HISTORY.md) — журнал, только при расследовании | без нужды |
| Деплой на VM | skill `datacore-deploy`, [deploy/synology/README.md](deploy/synology/README.md) | — |

## Структура (только значимое)

```
backend/src/main.ts            бутстрап: helmet, CORS, static /admin /uploads, ValidationPipe, фильтры, Swagger
backend/src/app.module.ts      список модулей, глобальные guard'ы/interceptor'ы, сиды
backend/src/common/            guards, decorators, filters, interceptors, seed/, idempotency, eav
backend/src/database/          подключение Mongo + глобальные плагины (soft-delete, audit, user-context)
backend/src/modules/<name>/    модуль: *.schema.ts, *.service.ts, *.controller.ts, dto/, *.spec.ts
backend/admin/                 админка (vanilla JS, без сборки) → /admin
backend/test/e2e/              e2e (нужен живой Mongo rs0)
backend/scripts/               разовые/аудит-скрипты (не часть рантайма)
deploy/synology/               deploy.py (деплой), backup.sh (cron-бэкап), verify-restore.js
docker-compose.yml             mongo:4.4 rs0 --auth --keyFile + backend (локально и на VM)
```

**Игнорируй:** `node_modules/`, `dist/`, `.data/` (живые данные Mongo/бэкапы — НЕ трогать), `backend/uploads/`, `pnpm-lock.yaml`.
**Секреты (gitignored, не читать без нужды, никогда не коммитить и не выводить в чат):** `.env`, `deploy/synology/config.env`, `deploy/synology/CREDENTIALS.md`.

## Команды (из `backend/`)

pnpm в PATH может не быть → используй `npx`.

| Что | Команда | Норма |
|--|--|--|
| Типы | `npx tsc --noEmit` | exit 0 |
| Юнит-тесты | `npx jest --silent` | 66 suites / 728 tests; e2e 18 / 138 (на 2026-10-18) |
| e2e | `npx jest --config ./test/jest-e2e.json --runInBand --forceExit` | нужен Mongo; см. skill `datacore-verify` |
| Сборка | `npx nest build` | exit 0 |
| Стек целиком | из корня: `docker compose up -d --build` | API `:3001` локально (`HOST_PORT`) |

## Жёсткие правила

1. **Не ломать контракт API.** Префикс ключей `kppd_`, пути `/api/...`, форма ответов `{items,total,page,limit}` — публичный контракт для внешних клиентов. Меняешь эндпоинт → перегенерируй `docs/openapi.json` и обнови `docs/MAP.md`.
2. **Данные священны.** Никаких `dropDatabase`, `deploy.py --wipe`, удаления коллекций, массовых `deleteMany` на живой БД без явного «да» пользователя. Деструктивные проверки — только на тестовой БД (`datacore-test`) или на копии.
3. **Прямой доступ к Mongo из клиентов запрещён** (VISION #1). Mongo публикуется только на `127.0.0.1`.
4. **Единая база (с 2026-10-18):** CRM kppdf (`/opt/kppdf-8.0`, `:3000`, репо `D:\kppdf-8.0`) работает **с той же базой `datacore`** напрямую (Mongo-пользователь `kppdf`, сеть `data-core_default`). Таблицы `kind:'crm'` в реестре админки — его живые данные: не удалять, схемы общих коллекций не ломать (их читают оба кода). Подробности — `docs/ARCHITECTURE.md` «Единая база»; та же договорённость со стороны kppdf — `D:\kppdf-8.0\docs\UNIFIED-DB.md`.
5. **На VM рядом работает прод-контур kppdf** (`:3000`, `/opt/kppdf*`). Его не трогать; data-core — `/opt/data-core`, `:3001`, контейнеры `datacore-*`.
6. Публично data-core доступен как `https://kppdf-crm.ru/db/` (VPS nginx → туннель → VM :3001; схема и откат — `deploy/synology/README.md` «Публичный доступ»). nginx на VPS общий с kppdf — правка только блока `/db/`, с бэкапом.
7. Mongo на VM — **4.4** (CPU без AVX). Не использовать фичи Mongo 5+.
8. Метки `TZ-…` в комментариях — исторические ID задач kppdf, искать их файлы не нужно. Ссылки на несуществующие доки из кода вычищены (T14); если встретишь новую — исправь на существующий файл.
9. После изменения кода: typecheck + юнит зелёные; обнови затронутые доки (skill `datacore-docs-sync`); задачу в `docs/TASKS.md` отметь `[x]`.
10. Коммиты — на русском, conventional-префикс (`fix:`, `feat(admin):`, `docs:`, `refactor(backend):`). Коммитить/пушить — только когда просит пользователь.

## Известные ловушки (сэкономят часы)

- В каждом объекте ответа есть строковый **`id`** (и `_id` там, где он был): это гарантирует глобальный `IdNormalizeInterceptor` (T18). Клиентам опираться на `id`.
- Мусорный ObjectId → `CastError` → глобальный фильтр отдаёт **400** (не 500).
- Rate-limit: глобально 10/с и 100/мин, `/auth/login` — 5/мин и 20/час. Серия запросов без пауз → 429, это не баг.
- `GET /api/admin/users` через `kppd_`-ключ → `total:0`: owner-админ скрыт от не-owner актора (TZ-AUTH-306). Не баг.
- Модели с soft-delete: обычные запросы скрывают `deletedAt != null`; админ-«Таблицы» читают сырые коллекции.
- `AuditService.log` приводит `entityId` к ObjectId — не-hex строку туда не клади (пиши в `details`).
- В БД есть таблицы CRM kppdf (`kind:'crm'` в реестре `modules/admin/collections-admin.controller.ts`) — это **живые данные kppdf** на общей базе: не удалять, не менять их схему из data-core.
- **Никогда не запускай `bash -x` / `set -x` на скриптах, которые читают `.env`** — трассировка печатает секреты (инцидент 2026-10-18, T22).
- Windows/Git Bash: `docker exec` с путями `/tmp/...` ломается → `MSYS_NO_PATHCONV=1`.
- e2e-харнесс (`test/setup/test-db.ts`) **дропает все коллекции** БД `MONGO_DB_TEST` (по умолч. `datacore-test`). Никогда не направляй его на `datacore`.

## Скиллы проекта (`.claude/skills/`)

- `datacore-verify` — как проверить изменение (typecheck, юнит, e2e, live-smoke).
- `datacore-new-module` — как добавить новую сущность/модуль по канону проекта.
- `datacore-docs-sync` — какие доки обновлять после изменения.
- `datacore-deploy` — безопасный деплой на VM.
