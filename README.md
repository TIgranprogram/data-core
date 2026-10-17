# Personal Data Core

**Личное независимое ядро данных.** MongoDB + REST API (NestJS) на своём сервере (Synology VM).
Данные живут здесь и **ни от какого приложения не зависят**: приложения ты пишешь, стираешь и переписываешь — а база остаётся, всегда актуальная и с бэкапами.

```
[Google Sheets] [Gemini/агент] [Python-app] [PHP-app] [будущее приложение]
        \              |              |            |            /
              ── REST API (один, вечный, с документацией) ──
                              |
            MongoDB (Replica Set rs0, ежедневный бэкап)
```

**Главное правило:** во внешние приложения уходит только API + ключ. Прямой доступ к MongoDB из чужого кода запрещён — так данные не сломать.

---

## Структура

```
data-core/
├── backend/            ← NestJS API (авторизация, ключи, модули данных)
├── docker-compose.yml  ← весь стек: mongo:7 (rs0) + backend
├── .env.example        ← шаблон настроек (скопируй в .env)
├── deploy/synology/    ← скрипты деплоя и бэкапа на Synology VM
└── docs/
    ├── CONNECT.md      ← КАК ПОДКЛЮЧИТЬСЯ с любой платформы (см. ниже)
    ├── ARCHITECTURE.md ← архитектура (унаследована из kppdf-8.0)
    ├── STACK.md        ← стек технологий
    ├── data-model.md   ← описание данных (90 сущностей)
    └── data-model-audit.md
```

## Быстрый старт

```bash
cp .env.example .env          # заполнить: JWT_SECRET, JWT_REFRESH_SECRET, ADMIN_PASSWORD
docker compose up -d --build
curl -sf http://localhost:3000/api/health/ready
```

- API: `http://localhost:3000/api/...`
- Health: `http://localhost:3000/api/health/ready`
- Swagger UI: `http://localhost:3000/docs` (в prod выключен, включается `SWAGGER_ENABLED=true`)
- Первый вход: `ADMIN_USERNAME` / `ADMIN_PASSWORD` из `.env`

## Подключение из других приложений

**Читай [docs/CONNECT.md](docs/CONNECT.md)** — там пошагово:
- вход по логину/паролю → JWT;
- машинные ключи `kppd_` (Google Sheets, скрипты, агенты);
- готовые примеры: curl, Google Apps Script, Python, PHP;
- роли и права (чтение / запись).

## Доступ и безопасность

| Что | Как |
|--|--|
| MongoDB | **только** `127.0.0.1:27017` — наружу не публикуется никогда |
| API | `:3000`, за JWT-авторизацией + rate limiting |
| Машинные ключи | `kppd_...`, выдаются админом, с TTL и отзывом |
| Роли | `admin` / `manager` / `user` + permissions на уровне модулей |

## Бэкапы

```bash
bash deploy/synology/backup.sh     # mongodump → ежедневно по cron (03:00)
```
Ретеншен — 14 дней (`BACKUP_RETENTION_DAYS`). Копию держать и вне NAS (USB/второй диск).
**Правило: бэкап без проверенного restore — не бэкап.** Restore-дрill делается один раз сразу после первого деплоя.

## Деплой на Synology VM

См. `deploy/synology/README.md`, `RUNBOOK.md`, `DEPLOY.md`.
Секреты (`config.env`, `CREDENTIALS.md`) в git не попадают.

---

## Известный балласт (будет чиститься)

Репозиторий вынесено из [kppdf-8.0](https://github.com/) **целиком, без вычистки** (по договорённости — сначала полный перенос, потом чистка). Внутри `backend/` сейчас много унаследованного домена CRM (`material`, `order`, `quotation`, `tender` и т.д.), который к личному ядру данных не относится. План чистки — в «Дорожной карте».

## Дорожная карта

- [ ] Чистка CRM-модулей: оставить auth/users/roles/permissions/settings/audit/health + нужные сущности
- [ ] Экспорт `openapi.json` в CI (публичный контракт для любых клиентов)
- [ ] Простой админ-интерфейс: пользователи (логин/пароль), роли, права «чтение/запись», список активных ключей
- [ ] MongoDB `--auth` + app-user (сейчас доступ к БД только по сети VM, но без пароля)
- [ ] MCP-обвязка поверх API (готовится на базе `desktop/mcp` из kppdf-8.0)
- [ ] Restore-дрилл бэкапа + копия вне NAS

---

_Создано выносом бэкенда из kppdf-8.0 (2026-10)._
