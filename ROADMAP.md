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
- [x] `.env.example` + `.gitignore`; документация: `README`, `docs/CONNECT.md` (JWT + ключи `kppd_` + примеры подключения для разных платформ)
- [x] Секреты вынесены из git в локальные gitignored `deploy/synology/config.env` + `CREDENTIALS.md`; инфра-данные (IP/домены) вычищены из трекаемых файлов (коммит `e2a3773`)
- [x] Клон на рабочую машину + копия секретов; промежуточная папка в kppdf-8.0 заархивирована и удалена

---

## 🎯 Первые шаги (P0) — сделать до начала активной работы

### 1. Локальный запуск и smoke-test
- [x] `cp .env.example .env`, заполнить секретами (взять из `deploy/synology/config.env`: `JWT_SECRET`, `JWT_REFRESH_SECRET`, `ADMIN_PASSWORD`)
- [x] `docker compose up -d --build` → `curl -sf http://localhost:3001/api/health/ready` → **200**
- [x] Войти `admin` / пароль из `.env` → `POST /api/auth/login` возвращает `{ access, refresh, user }`
- [ ] Сменить дефолтный пароль админа после первого входа
- _Критерий: API отвечает, вход работает_ ✅

> ⚠️ **Порты (2026-10-17):** на рабочей машине уже крутится контур `odr` на 3000/27017 → data-core поднят на **3001** (API) и **27018** (mongo). В `.env`: `HOST_PORT=3001`, `MONGO_PORT=27018`. Swagger включён → `http://localhost:3001/docs`. **Админка: `http://localhost:3001/admin`** (без сборки, vanilla JS).

### 2. Первый ключ и первое подключение (доказать концепт)
- [x] Выдать ключ: `POST /api/desktop/pairing-keys` (см. [docs/CONNECT.md](docs/CONNECT.md)) → `kppd_...` (TTL 30d)
- [x] Проверить чтение данных ключом через `curl` → `GET /api/health/ready` с Bearer-ключом = **200**
- [ ] Подключить **любой удобный внешний клиент** и проверить чтение/запись (примеры в CONNECT.md: таблица через Apps Script, скрипт на Python, PHP — пример любой, важно проверить сам механизм)
- _Критерий: внешний клиент видит данные из базы и пишет в неё; тот же ключ/документация работают для любого другого клиента_

> 📝 `GET /api/admin/users` через `kppd_`-ключ вернёт `total:0` — это **не баг**: seeded-admin = «owner», скрыт от не-owner актора (TZ-AUTH-306), а у машинного ключа нет owner-флага. Через обычный JWT админ видит себя. Для данных ключ работает штатно.

### 3. Бэкапы (до того, как появятся ценные данные)
- [x] **Адаптировать `deploy/synology/backup.sh` под data-core**: заменено на `datacore-mongo` / `datacore` (и `KPPDF_DATA_DIR` → `DATA_DIR=/var/lib/datacore`)
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
- [x] Простой UI/API: список пользователей, создание (логин/пароль), роль «чтение / чтение+запись»
- [x] Список активных ключей с метками/TTL и кнопкой отзыва
- _Критерий: нового пользователя и ключ можно завести без БД и curl_ ✅

> 🛠 **Готово (2026-10-17):** статическая админка `backend/admin/` (vanilla JS, без сборки), отдаётся тем же NestJS на **`http://localhost:3001/admin`**. Вход по JWT, два раздела: **Пользователи** (список/поиск/создание/изменение/сброс пароля/удаление) и **API-ключи** (список/TTL/выдача с одноразовым показом `kppd_`/отзыв). Смонтирована в `main.ts` (`/admin`), скопирована в Docker-образ. Проверено end-to-end в браузере: логин → список пользователей → вкладка ключей.

### 8. Деплой отдельным контуром на VM
- [ ] Адаптировать `deploy/synology/deploy.*` под data-core (сейчас заточены под kppdf: сборка фронта, `REMOTE_DIR=/opt/kppdf-8.0`)
- [ ] Поднять на VM рядом с работающим kppdf: `REMOTE_DIR=/opt/data-core`, `KPPDF_DATA_DIR=/var/lib/datacore` (уже прописано в локальном `config.env`)
- [ ] Health-check + первый реальный ключ на прод-контуре
- _Критерий: `http://<LAN_IP>:3000/api/health/ready` отвечает, CRM не пострадал (IP — в локальном `deploy/synology/CREDENTIALS.md`)_

---

## 🔮 Позже (P2)

- [ ] **Необязательные адаптеры под конкретные экосистемы** — только по реальной надобности, базовый контракт остаётся универсальным REST API: например, MCP-сервер для AI-агентов (прототип есть в kppdf-8.0 `desktop/mcp` — адаптировать, не писать новый), коннекторы для таблиц и т.п.
- [ ] Отдельный read-only SSH-туннель к VM для внешних клиентов (VPS-туннель в kppdf уже настроен — переиспользовать паттерн)
- [ ] Ротация/отзыв ключей по расписанию, оповещения о новых интеграциях
- [ ] Рассмотреть Directus поверх той же БД как веб-админку (если ручной UI через API станет неудобен)
- [ ] Change Streams / read-реплика — если понадобится отдавать данные внешним на чтение без нагрузки на основную запись

---

## ⚠️ Известные шероховатости (учесть)

| Место | Что не так | Что сделать |
|--|-----------|-------------|
| `.gitignore` (инцидент 2026-10-17) | Строка `uploads/` матчила `backend/src/modules/uploads/` и вырезала модуль из git → `nest build` падал. **Исправлено:** `/uploads/` + `backend/uploads/`, модуль восстановлен из kppdf | ✅ Закрыто; не возвращать голое `uploads/` |
| Порты на рабочей машине | Контур `odr` занимает 3000/27017 | data-core на **3001/27018** (`.env`: `HOST_PORT`, `MONGO_PORT`); в compose порты параметризованы |
| `deploy/synology/backup.sh` | Был настроен на `kppdf-mongo` / БД `kppdf` | ✅ Адаптирован на `datacore-mongo` / `datacore` (задача 3) |
| `deploy/synology/deploy.*` | Заточены под kppdf (сборка NX-фронта, `REMOTE_DIR=/opt/kppdf-8.0`, mongo 4.4) | Адаптировать (задача 8); `docker-compose.prod.yml` уже создан (контур :3001, mongo 7) |
| `docker-compose.prod.yml` | Создан, но ещё не проверен реальным деплоем на VM | Задача 8 |
| MongoDB | Без аутентификации (`--auth` не включён) | Задача 4 |
| `backend/` | 92 модуля, большинство — CRM-балласт | Задача 5 |
| Swagger | В prod выключен (`main.ts`), `openapi.json` нигде не экспортируется | Задача 6 |
| Версии Mongo | В prod kppdf — mongo 4.4; здесь — mongo 7 | Не смешивать контуры; не поднимать data-core на 4.4 |
| `docs/ARCHITECTURE.md`, `STACK.md` | Исторические (из kppdf), содержат упоминания CRM | Переписать после чистки модулей |
| `package.json` (backend) | `name: "kppdf-8.0-backend"`, swagger-title «KPPDF API» | Переименовать при чистке (задача 5/8) |
| `kppd_`-ключ и `/api/admin/users` | Ключ не несёт owner-флага → owner-admin скрыт (TZ-AUTH-306), `total:0` | Ожидаемо; для данных ключ работает. Не путать за баг |
