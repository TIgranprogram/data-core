# Personal Data Core

**Единая личная база данных.** MongoDB + REST API (NestJS) + админка на своём сервере (Synology VM).
Данные живут здесь и не зависят от приложений: приложения пишутся, стираются и переписываются, а база остаётся — актуальная и с бэкапами.

```
[Google-таблица] [Скрипт] [Новое приложение] [ИИ-агент]     [CRM kppdf]
        \             |            |             /                |
     REST API data-core + ключ kppd_ (https://kppdf-crm.ru/db/api)  |  напрямую (общая схема)
                              \                                   /
                    MongoDB datacore (rs0, --auth, бэкап ежедневно)
```

**Правило:** внешние клиенты работают только через API + ключ. Прямой доступ к MongoDB есть только у самого API и у CRM kppdf (общий код-предок, общие схемы).

## Адреса

| Что | Где |
|--|--|
| Админка | `https://kppdf-crm.ru/db/admin/` (из домашней сети также `http://<IP-VM>:3001/admin`) |
| API | `https://kppdf-crm.ru/db/api/...` |
| CRM kppdf | `https://kppdf-crm.ru/` |
| Контракт API | [docs/openapi.json](docs/openapi.json) (Swagger UI в prod выключен) |

## Навигация

> 🤖 **ИИ-агентам:** начинать с [AGENTS.md](AGENTS.md).

| Документ | Что внутри |
|--|--|
| [docs/CONNECT.md](docs/CONNECT.md) | Как подключить любое приложение: ключ, примеры, хранилище `/api/apps` |
| [docs/TASKS.md](docs/TASKS.md) | Открытые задачи |
| [ROADMAP.md](ROADMAP.md) | Где мы и куда дальше |
| [VISION.md](VISION.md) | Зачем проект и принципы |
| [docs/MAP.md](docs/MAP.md) · [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/data-model.md](docs/data-model.md) | Код, устройство, сущности |
| [deploy/synology/README.md](deploy/synology/README.md) | Сервер: деплой, туннель `/db/`, единая база, откат |
| [deploy/backup-pull/README.md](deploy/backup-pull/README.md) | Копия бэкапов на Windows-ПК, восстановление |
| [docs/HISTORY.md](docs/HISTORY.md) | Что сделано и как проверялось |

## Структура

```
data-core/
├── AGENTS.md / CLAUDE.md   ← вход для ИИ-агентов
├── backend/                ← NestJS API (src/, admin/ — админка, test/, scripts/)
├── docker-compose.yml      ← локальный контур: mongo:4.4 (rs0, --auth) + backend
├── docker-compose.prod.yml ← контур на VM
├── deploy/synology/        ← деплой (deploy.py), бэкап (backup.sh), туннель, nginx-блок /db/
├── deploy/backup-pull/     ← копия бэкапов на Windows
├── .claude/                ← скиллы агентов и настройки доступа
└── docs/                   ← CONNECT, TASKS, MAP, ARCHITECTURE, data-model, HISTORY, openapi.json
```

## Локальный запуск

```bash
cp .env.example .env    # заполнить секреты (JWT_*, ADMIN_PASSWORD, MONGO_*)
docker compose up -d --build
curl -sf http://localhost:3001/api/health/ready
```
Порты на этой машине: API `:3001`, Mongo `127.0.0.1:27018` (`HOST_PORT`, `MONGO_PORT` в `.env`; 3000/27017 заняты другим контуром). Mongo — `4.4` (CPU VM без AVX).

## Безопасность и бэкапы

- Mongo только на `127.0.0.1`, `--auth` + keyfile; отдельные пользователи: `datacore` (API), `kppdf` (CRM), `root` (бэкапы).
- API: JWT или ключ `kppd_` (TTL, отзыв, права read / write / full + список приложений); rate-limit; аудит.
- Бэкап: VM ежедневно 03:00 → `/var/lib/datacore/backups` (14 дней) + копия на этот ПК → `D:\datacore-backups` (30 дней). Restore проверен.

_Создано выносом бэкенда из kppdf-8.0 (2026-10); с 2026-10-18 — единая база и для kppdf._
