# Personal Data Core

**Личное независимое ядро данных.** MongoDB + REST API (NestJS) на своём сервере (Synology VM).
Данные живут здесь и **ни от какого приложения не зависят**: приложения ты пишешь, стираешь и переписываешь — а база остаётся, всегда актуальная и с бэкапами.

```
[Веб-приложение] [Таблица] [Скрипт] [Мобильное приложение] [AI-агент] [будущий клиент]
        \              |            |            |              |           /
              ── REST API (один, вечный, с документацией) ──
                              |
            MongoDB (Replica Set rs0, ежедневный бэкап)
```

**Главное правило:** во внешние приложения уходит только API + ключ. Прямой доступ к MongoDB из чужого кода запрещён — так данные не сломать.

---

## 📚 Навигация

> 🤖 **ИИ-агентам:** начинать с [AGENTS.md](AGENTS.md) — там карта документации, команды, правила и ловушки.

| Документ | Что внутри |
|--|--|
| **[VISION.md](VISION.md)** | Зачем проект, решения, принципы |
| **[ROADMAP.md](ROADMAP.md)** | План (P0/P1/P2) |
| **[docs/TASKS.md](docs/TASKS.md)** | Единый бэклог открытых задач (аудит 2026-10-18) |
| **[docs/CONNECT.md](docs/CONNECT.md)** | Как подключиться: JWT, ключи `kppd_`, примеры |
| **[docs/MAP.md](docs/MAP.md)** | Карта кода: модуль → маршруты → коллекции |
| **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** | Путь запроса, auth/RBAC, слой данных, инфраструктура |
| **[docs/data-model.md](docs/data-model.md)** | Сущности и поля (~28) |
| **[docs/HISTORY.md](docs/HISTORY.md)** | Журнал сделанного и проверок |

---

## Структура

```
data-core/
├── AGENTS.md / CLAUDE.md ← вход для ИИ-агентов
├── VISION.md / ROADMAP.md
├── backend/              ← NestJS API (src/, admin/ — админка, test/, scripts/)
├── docker-compose.yml    ← mongo:4.4 (rs0, --auth) + backend
├── .env.example          ← шаблон настроек (скопируй в .env)
├── deploy/synology/      ← деплой (deploy.py) и бэкап (backup.sh) на VM
├── .claude/skills/       ← скиллы агентов: verify, new-module, docs-sync, deploy
└── docs/                 ← TASKS, MAP, ARCHITECTURE, CONNECT, data-model, HISTORY, openapi.json
```

## Быстрый старт

```bash
cp .env.example .env          # заполнить: JWT_SECRET, JWT_REFRESH_SECRET, ADMIN_PASSWORD,
                              # MONGO_ROOT_PASSWORD, MONGO_APP_PASSWORD, MONGO_KEYFILE_SECRET
docker compose up -d --build
curl -sf http://localhost:3000/api/health/ready
```

- API: `http://localhost:3000/api/...`
- Health: `http://localhost:3000/api/health/ready`
- Swagger UI: `http://localhost:3000/docs` (в prod выключен, включается `SWAGGER_ENABLED=true`)
- Первый вход: `ADMIN_USERNAME` / `ADMIN_PASSWORD` из `.env`

> **Порты и AVX.** По умолчанию Mongo публикуется на `127.0.0.1:27017`, API — на `:3000`.
> Если эти порты уже заняты другим контуром (например, kppdf), задай в `.env`
> `MONGO_PORT` и `HOST_PORT` (data-core-контур идёт на `:27018` / `:3001`).
> Образ Mongo по умолчанию **`mongo:4.4`** — на CPU без AVX (Celeron J4125 на Synology VM)
> MongoDB 5.0+ падает с «Illegal instruction»; на AVX-железе можно поднять `MONGO_IMAGE=mongo:7`.

## Подключение из других приложений

**Читай [docs/CONNECT.md](docs/CONNECT.md)** — там пошагово:
- вход по логину/паролю → JWT;
- машинные ключи `kppd_` — для внешних клиентов (скрипты, таблицы, боты, приложения);
- готовые примеры: curl, таблица (Apps Script), Python, PHP — именно примеры, подойдёт **любой** клиент, умеющий HTTP;
- роли и права (чтение / запись).

## Доступ и безопасность

| Что | Как |
|--|--|
| MongoDB | **только** `127.0.0.1:<MONGO_PORT>` (по умолч. 27017) — наружу не публикуется никогда |
| API | `:3000` (или заданный `HOST_PORT`), за JWT-авторизацией + rate limiting + `--auth` (root/app-user) |
| Машинные ключи | `kppd_...`, выдаются админом, с TTL и отзывом |
| Роли | `admin` / `manager` / `user` + permissions на уровне модулей |

## Бэкапы

```bash
bash deploy/synology/backup.sh     # mongodump → ежедневно по cron (03:00)
```
Ретеншен — 14 дней (`BACKUP_RETENTION_DAYS`). Копию держать и вне NAS (USB/второй диск).
**Правило: бэкап без проверенного restore — не бэкап.** Restore-дрилл делается один раз сразу после первого деплоя.

> ✅ `deploy/synology/backup.sh` адаптирован под data-core (контейнеры `datacore-*`, БД `datacore`) и уже висит в cron на VM (`/etc/cron.d/datacore`, ежедневно 03:00, ротация 14 дней). Restore-дрилл прогнан и локально, и на VM — все записи совпадают. Все остальные «подводные камни» — в [ROADMAP.md](ROADMAP.md), раздел «Известные шероховатости».

## Деплой на Synology VM

См. [deploy/synology/README.md](deploy/synology/README.md) и skill `datacore-deploy`.
Секреты (`config.env`, `CREDENTIALS.md`) в git не попадают — держатся локально и копируются в клон вручную.

---

## Статус и планы

Проект вынесен из kppdf-8.0 **целиком, без вычистки** (сначала полный перенос, потом чистка). Чистка выполнена (задача H): из 93 модулей оставлено **37** — платформенное ядро (авторизация, ключи, пользователи, роли/права, аудит, настройки, устройства/desktop, статусы) + канонические справочники (организации, контрагенты, люди, площадки, категории, единицы, валюты, цвета, материалы, изделия, модули изделий, фото, атрибуты, виды работ). Транзакционный CRM-домен (сделки, заказы, склад, производство, документооборот DocStudio, импорты и т.п.) удалён.

- **Что сделано и что делать дальше** — чек-листы в [ROADMAP.md](ROADMAP.md)
- **Почему так и какие были альтернативы** — [VISION.md](VISION.md)

---

_Создано выносом бэкенда из kppdf-8.0 (2026-10)._
