# ROADMAP — что сделано, что делать

> Чек-лист проекта. Обновляй по мере прохождения: `[x]` = сделано.
> Контекст и «почему» — в [VISION.md](../VISION.md). Как подключаться — в [docs/CONNECT.md](docs/CONNECT.md).

---

## ✅ Сделано (2026-10)

- [x] Идея: личное независимое ядро данных, отделить данные от приложений (см. VISION)
- [x] Выбрана архитектура: свой API поверх MongoDB, переиспользование боевого бэкенда kppdf-8.0
- [x] Создан репозиторий https://github.com/TIgranprogram/data-core (Private)
- [x] Вынесен бэкенд целиком (890 файлов: src, тесты, Dockerfile; без node_modules/dist/.env/uploads)
- [x] Самодостаточный `docker-compose.yml`: `mongo:7` (rs0) + backend; Mongo только на `127.0.0.1`
- [x] `.env.example` + `.gitignore`; документация: `README`, `docs/CONNECT.md` (JWT + ключи `kppd_` + примеры Apps Script / Python / PHP / агент)
- [x] Секреты вынесены из git в локальные gitignored `deploy/synology/config.env` + `CREDENTIALS.md`; инфра-данные (IP/домены) вычищены из трекаемых файлов (коммит `e2a3773`)
- [x] Клон на рабочую машину + копия секретов; промежуточная папка в kppdf-8.0 заархивирована и удалена

---

## 🎯 Первые шаги (P0) — сделать до начала активной работы

### 1. Локальный запуск и smoke-test
- [ ] `cp .env.example .env`, заполнить секретами (взять из `deploy/synology/config.env`: `JWT_SECRET`, `JWT_REFRESH_SECRET`, `ADMIN_PASSWORD`)
- [ ] `docker compose up -d --build` → `curl -sf http://localhost:3000/api/health/ready`
- [ ] Войти `admin` / пароль из `.env` → `POST /api/auth/login` возвращает `{ access, refresh, user }`
- [ ] Сменить дефолтный пароль админа после первого входа
- _Критерий: API отвечает, вход работает_

### 2. Первый ключ и первое подключение (доказать концепт)
- [ ] Выдать ключ: `POST /api/desktop/pairing-keys` (см. [docs/CONNECT.md](docs/CONNECT.md))
- [ ] Проверить чтение данных ключом через `curl`
- [ ] Подключить Google Таблицу (Apps Script из CONNECT.md): чтение + запись
- _Критерий: таблица показывает данные из базы и пишет в неё_

### 3. Бэкапы (до того, как появятся ценные данные)
- [ ] **Адаптировать `deploy/synology/backup.sh` под data-core**: сейчас он указывает на контейнер `kppdf-mongo` и БД `kppdf` → заменить на `datacore-mongo` / `datacore` (и `KPPDF_DATA_DIR` → `DATA_DIR=/var/lib/datacore`)
- [ ] Настроить cron на VM: `0 3 * * * cd /opt/data-core && bash deploy/synology/backup.sh >> /var/log/datacore-backup.log 2>&1`
- [ ] **Restore-дрилл**: восстановить дамп в тестовую БД и убедиться, что данные читаются
- [ ] Копия бэкапов вне NAS (USB / второй диск)
- _Критерий: бэкап создаётся ежедневно и восстановлен хотя бы раз_

### 4. Аутентификация MongoDB
- [ ] Включить `--auth` + создать root/app-user в compose; бэкенд подключается с `authSource`
- [ ] Убедиться: `27017` недоступна ни с какой машины, кроме VM
- _Критерий: прямое подключение к Mongo без пароля отклоняется_

---

## 🛣 Дальше (P1)

### 5. Чистка CRM-модулей (балласт из kppdf)
- [ ] Оставить: `auth`, `user`, `role`, `permissions`, `setting`, `feature-flag`, `audit-log`, `health`, `desktop` (ключи), `rate-limit`
- [ ] Удалить CRM-домен: `quotation`, `tender`, `rpp`, `work-order*`, `production*`, `shipment`, `supply`, `studio-document`, `template-block`, `table-template`, `warehouse`, `storage-item`, `stock-movement`, `reservation`, `purchase-*`, `cost-*`, `product*`, `material`, `counterparty`, `person`, `interaction`, …
- [ ] Почистить seed'ы, e2e-тесты удалённых модулей, ссылки в `app.module.ts`
- [ ] Обновить `docs/data-model.md` (оставить только действующие сущности)
- _Критерий: `pnpm typecheck && pnpm test` зелёные; сборка образа проходит_

### 6. Публичный контракт (OpenAPI)
- [ ] CI/скрипт экспорта `openapi.json` в репозиторий
- [ ] Решить: Swagger UI под ключом в prod (`SWAGGER_ENABLED=true`) или только статический `openapi.json`
- _Критерий: любая платформа может сгенерировать клиент по файлу из репозитория_

### 7. Админка пользователей и доступов
- [ ] Простой UI/API: список пользователей, создание (логин/пароль), роль «чтение / чтение+запись»
- [ ] Список активных ключей с метками/TTL и кнопкой отзыва
- _Критерий: нового пользователя и ключ можно завести без БД и curl_

### 8. Деплой отдельным контуром на VM
- [ ] Адаптировать `deploy/synology/deploy.*` под data-core (сейчас заточены под kppdf: сборка фронта, `REMOTE_DIR=/opt/kppdf-8.0`)
- [ ] Поднять на VM рядом с работающим kppdf: `REMOTE_DIR=/opt/data-core`, `KPPDF_DATA_DIR=/var/lib/datacore` (уже прописано в локальном `config.env`)
- [ ] Health-check + первый реальный ключ на прод-контуре
- _Критерий: `http://<LAN_IP>:3000/api/health/ready` отвечает, CRM не пострадал (IP — в локальном `deploy/synology/CREDENTIALS.md`)_

---

## 🔮 Позже (P2)

- [ ] **MCP поверх API** — чтобы агенты работали с данными как с инструментом (прототип: `desktop/mcp` из kppdf-8.0; адаптировать, не писать новый)
- [ ] Отдельный read-only SSH-туннель к VM для внешних клиентов (VPS-туннель в kppdf уже настроен — переиспользовать паттерн)
- [ ] Ротация/отзыв ключей по расписанию, оповещения о новых интеграциях
- [ ] Рассмотреть Directus поверх той же БД как веб-админку (если ручной UI через API станет неудобен)
- [ ] Change Streams / read-реплика — если понадобится отдавать данные внешним на чтение без нагрузки на основную запись

---

## ⚠️ Известные шероховатости (учесть)

| Место | Что не так | Что сделать |
|--|-----------|-------------|
| `deploy/synology/backup.sh` | Указывает на контейнер `kppdf-mongo` и БД `kppdf` | Адаптировать (задача 3) |
| `deploy/synology/deploy.*` | Заточены под kppdf (сборка фронта, пути) | Адаптировать (задача 8) |
| MongoDB | Без аутентификации (`--auth` не включён) | Задача 4 |
| `backend/` | 92 модуля, большинство — CRM-балласт | Задача 5 |
| Swagger | В prod выключен (`main.ts`), `openapi.json` нигде не экспортируется | Задача 6 |
| Версии Mongo | В prod kppdf — mongo 4.4; здесь — mongo 7 | Не смешивать контуры; не поднимать data-core на 4.4 |
| `docs/ARCHITECTURE.md`, `STACK.md` | Исторические (из kppdf), содержат упоминания CRM | Переписать после чистки модулей |
