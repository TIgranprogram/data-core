# AGENTS.md — вход для ИИ-агента (читать первым)

> Цель файла: агент понимает проект **без чтения всего репо**. Читай по необходимости только то, на что указывает этот файл.
> Язык проекта — русский (доки, коммиты, комментарии к новому коду). Пользователь — не разработчик: отвечай коротко, по делу.

## Что это

**Personal Data Core** — личное ядро данных: MongoDB (rs0) + REST API на NestJS 10 / Mongoose 8. Данные живут здесь, клиенты (таблицы, скрипты, приложения, ИИ-агенты) ходят **только через API** по JWT или машинному ключу `kppd_…`. Бэкенд вынесен из старого проекта **kppdf-8.0** (CRM) и вычищен до 37 модулей: платформенное ядро + канонические справочники.

## ▶ Сейчас главное (с 2026-10-19)

Доводим до полностью рабочего состояния **одно** приложение — «Рабочее место» (`backend/pwa/` → `/db/app/`): заявки, склад, контрагенты, заказы, доходы/расходы. CRM kppdf заморожена.
1. [docs/PRODUCT.md](docs/PRODUCT.md) — что должно уметь (и принятые решения).
2. [docs/CANON.md](docs/CANON.md) — **законы**: единый дизайн, устройство экранов, удаление, проверка в браузере, как говорить с пользователем.
3. [docs/TASKS.md](docs/TASKS.md) — чек-лист по фазам; продолжай с первого `[~]` / `[ ]`.

## Карта документации (что читать под задачу)

| Задача | Читай | Не читай |
|--|--|--|
| Любая работа над приложением/админкой | [docs/CANON.md](docs/CANON.md) + раздел в [docs/PRODUCT.md](docs/PRODUCT.md) | — |
| Вид интерфейса: цвета, шрифты, отступы, компоненты, «сливается / криво» | skill `datacore-design` → [docs/DESIGN.md](docs/DESIGN.md) | `base.css` целиком |
| Любая работа с кодом | [docs/MAP.md](docs/MAP.md) — модуль → маршруты → коллекции → файлы | весь `backend/src` подряд |
| Как устроен запрос, auth, RBAC, плагины | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | — |
| Поля сущностей | [docs/data-model.md](docs/data-model.md) (ориентир), истина — `*.schema.ts` | — |
| Схема таблиц / контракт для клиента | живой API: `GET /api/meta/schema`, `/api/meta/openapi.json`, `/api/meta/guide` (модуль `modules/meta`); в админке — вкладка «Подключение» | — |
| Точный контракт эндпоинта | `docs/openapi.json` — **только grep по пути**, файл 175 КБ | целиком |
| Что делать / открытые задачи | [docs/TASKS.md](docs/TASKS.md) (бэклог) — Grep по коду задачи или первый `[ ]`, не целиком; [ROADMAP.md](ROADMAP.md) (план) | TASKS целиком |
| Архитектура: циклы модулей, общие коллекции, DTO, рефакторинг | [docs/ARCH-PLAN.md](docs/ARCH-PLAN.md) — ТЗ и чек-листы (М — мелкие, АБЗ — большие) | — |
| Команда агентов: роли, границы, ТЗ, поток задачи | [docs/roles/README.md](docs/roles/README.md), агенты — `.claude/agents/` | — |
| Вопросы, ждущие решения пользователя | [docs/QUESTIONS.md](docs/QUESTIONS.md) — новые вопросы записывать туда; мёртвый код не оставлять | — |
| Подключение внешних клиентов | [docs/CONNECT.md](docs/CONNECT.md) | — |
| Зачем проект, принципы | [VISION.md](VISION.md) | — |
| Данные на проде (правит только пользователь) | [docs/DATA-FIX-USER.md](docs/DATA-FIX-USER.md) — дополнять, не исполнять | — |
| Что уже сделано и как проверялось | [docs/HISTORY.md](docs/HISTORY.md) — журнал: только Grep / хвост при расследовании | целиком |
| Деплой на VM | skill `datacore-deploy`, [deploy/synology/README.md](deploy/synology/README.md) | — |

## Структура (только значимое)

```
backend/src/main.ts            бутстрап: helmet, CORS, static /admin /uploads, ValidationPipe, фильтры, Swagger
backend/src/app.module.ts      список модулей, глобальные guard'ы/interceptor'ы, сиды
backend/src/common/            guards, decorators, filters, interceptors, seed/, idempotency, eav
backend/src/database/          подключение Mongo + глобальные плагины (soft-delete, audit, user-context)
backend/src/modules/<name>/    модуль: *.schema.ts, *.service.ts, *.controller.ts, dto/, *.spec.ts
backend/admin/                 админка (vanilla JS, без сборки) → /admin
backend/pwa/                   приложение «Снабжение / Склад» (vanilla JS, PWA, офлайн) → /app
backend/test/e2e/              e2e (нужен живой Mongo rs0)
backend/scripts/               разовые/аудит-скрипты (не часть рантайма)
deploy/synology/               deploy.py (деплой), backup.sh (cron-бэкап), verify-restore.js
deploy/google-sheets/          как сервер читает Google-таблицы (инструкция; сам код — modules/sheets-sync)
deploy/supply-app/             инструкция приложения «Склад · Снабжение»
docker-compose.yml             mongo:4.4 rs0 --auth --keyFile + backend (локально и на VM)
```

**Игнорируй:** `node_modules/`, `dist/`, `.data/` (живые данные Mongo/бэкапы — НЕ трогать), `backend/uploads/`, `pnpm-lock.yaml`.
**Доступ к стенду и проду — только агент `datacore-access` через `bash deploy/synology/api.sh <local|prod> GET /api/…`** (сам входит, пароль не показывает); остальные пароли и файлы секретов не читают.
**Секреты (gitignored, не читать без нужды, никогда не коммитить и не выводить в чат):** `.env`, `deploy/synology/config.env`, `deploy/synology/CREDENTIALS.md`.

## Команды (из `backend/`)

pnpm в PATH может не быть → используй `npx`.

| Что | Команда | Норма |
|--|--|--|
| Типы | `npx tsc --noEmit` | exit 0 |
| Юнит-тесты | `npx jest --silent` | 160 suites / 1598 tests; e2e 36 / 284 (на 2026-10-26) |
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
10. **Другой сервер (стенд друга, переезд) — только папка `SRV-ERP/`** (решение пользователя 2026-10-26). Код `backend/`, `deploy/synology/` ради чужого сервера не править; отличия — переменными его `.env` (`HTTP_STAND=1`, `CORS_ORIGIN`). Нужна правка кода — под переключателем, прод по умолчанию не меняется. Наш прод — только `deploy/synology/release.sh`. Причина: 2026-10-25 правка для стенда сняла HSTS на проде, копия папки положила на VM скрипты с CRLF (сломан бэкап).
11. Коммиты — на русском, conventional-префикс (`fix:`, `feat(admin):`, `docs:`, `refactor(backend):`). Когда коммитить и строка-эстафета — `CLAUDE.md`.

## Известные ловушки (частые; редкие — [docs/traps.md](docs/traps.md))

- В каждом объекте ответа есть строковый **`id`** (и `_id` там, где он был): это гарантирует глобальный `IdNormalizeInterceptor` (T18). Клиентам опираться на `id`.
- `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })` (`main.ts`): любой новый DTO (в т. ч. для `@Query`) **сразу** даст 400 на поля, которых в нём нет, — клиенты их шлют сейчас. Перед DTO собрать реальные поля запросов (М10, АБЗ-6).
- Модели с soft-delete: обычные запросы скрывают `deletedAt != null`; админ-«Таблицы» читают сырые коллекции.
- Склад и снабжение (`materials`, `storageitems`, `stockmovements`, `reservations`, `warehouses`, `supplyrequests`) — **общие с CRM**: модули `stock`/`supply` пишут их по правилам kppdf, схемы в `stock/schemas/` и `supply/` — копии kppdf (менять синхронно). См. `docs/UNIFY-SUPPLY-WAREHOUSE.md`.
- Проверка pwa/admin: `node --check файл.js` **молча пропускает** синтаксические ошибки ES-модулей — только `node --input-type=module --check < файл` (2026-10-22: так в приложение чуть не ушла ошибка, ломавшая весь экран).
- Паспорта: один вид (с 2026-10-23, БЗ-7 шаг 1б) — PDF только по категории и тексту по справочникам (`textSnapshot`; нет — собирается при печати, нет категории — 400); флага `passports.v2` больше нет. ТЗ — `docs/PASSPORTS-V2.md`. Шаблоны категорий — `passporttemplates`, тексты «Для всех» — в коде (`scripts/passport-texts.v2.json`).
- e2e-харнесс (`test/setup/test-db.ts`) **дропает все коллекции** БД `MONGO_DB_TEST` (по умолч. `datacore-test`). Никогда не направляй его на `datacore`.

## Скиллы проекта (`.claude/skills/`)

- `datacore-design` — правка вида интерфейса по дизайн-системе (`docs/DESIGN.md`).
- `datacore-verify` — как проверить изменение (typecheck, юнит, e2e, live-smoke).
- `datacore-new-module` — как добавить новую сущность/модуль по канону проекта.
- `datacore-docs-sync` — какие доки обновлять после изменения.
- `datacore-deploy` — безопасный деплой на VM.
