# ROADMAP — что сделано, что делать

> Чек-лист проекта. Обновляй по мере прохождения: `[x]` = сделано.
> Контекст и «почему» — в [VISION.md](../VISION.md). Как подключаться — в [docs/CONNECT.md](docs/CONNECT.md).

---

## ✅ Сделано (2026-10)

- [x] Идея: личное независимое ядро данных, отделить данные от приложений (см. VISION)
- [x] Выбрана архитектура: свой API поверх MongoDB, переиспользование боевого бэкенда kppdf-8.0
- [x] Создан репозиторий https://github.com/TIgranprogram/data-core (Private)
- [x] Вынесен бэкенд целиком (890 файлов: src, тесты, Dockerfile; без node_modules/dist/.env/uploads)
- [x] Самодостаточный `docker-compose.yml`: `mongo:4.4` (rs0; позже понижен с `mongo:7` — см. AVX ниже) + backend; Mongo только на `127.0.0.1`
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
- [x] Настроить cron на VM: `0 3 * * * cd /opt/data-core && bash deploy/synology/backup.sh >> /var/log/datacore-backup.log 2>&1`
  - 📝 Выполнено 2026-10-17: на VM не было cron → `apt-get install cron` + `systemctl enable --now cron`; джоба в `/etc/cron.d/datacore` (ротация 14 дней), ручной прогон бэкапа (91 коллекция) прошёл
- [x] **Restore-дрилл**: восстановить дамп в тестовую БД и убедиться, что данные читаются
  - 📝 Выполнено 2026-10-17 локально: `mongorestore --db datacore_restore_test` → 91 коллекция, **107/107 документов**, `admin` читается (`role=admin, isOwner=true`); тестовая БД после сверки удалена. Скрипт сверки: `deploy/synology/verify-restore.js`
- [ ] Копия бэкапов вне NAS (USB / второй диск)
- _Критерий: бэкап создаётся ежедневно и восстановлен хотя бы раз_

### 4. Аутентификация MongoDB
- [x] Включить `--auth` + создать root/app-user в compose; бэкенд подключается с `authSource`
  - 📝 Выполнено 2026-10-17 (локальный контур): `--auth` + **`--keyFile`** (MongoDB требует `security.keyFile` при `--auth`+replica set — keyfile генерирует одноразовый сервис `mongo-keyfile` в именованном томе `mongo-secrets`, 600/uid 999). Пользователи: `root` (admin db, для init/бэкапов) и `datacore` (readWrite на `datacore`, `authSource=datacore` в `MONGO_URI`). На существующем datadir пользователей создал `backend/scripts/mongo-bootstrap-auth.js` (пароли из env, в репо не лежат); healthcheck и `rs.initiate` теперь логинятся как root. `backup.sh` обновлён (`mongodump -u root --authenticationDatabase admin`).
- [x] Убедиться: `27017` недоступна ни с какой машины, кроме VM
  - 📝 Локально: `docker port` → `127.0.0.1:27018`; `Test-NetConnection LAN-IP:27018` → **False**, `127.0.0.1:27018` → True. На VM дополнительно проверить после деплоя.
- _Критерий: прямое подключение к Mongo без пароля отклоняется_ ✅ (`Command find requires authentication`)

---

## 🛣 Дальше (P1)

### 5. Чистка CRM-модулей (балласт из kppdf) ✅
- [x] Оставить по границе **VISION #4** (платформенное ядро + канонические справочники): `auth`, `user`, `role`, `permissions`, `admin`, `setting`, `feature-flag`, `audit`, `desktop`, `rate-limit`, `device-enrollment`, `status`, `photos`, `counter`, `dictionary-label`, + канонические справочники `organization`, `counterparty`, `person`, `site`, `role-org`, `role-counterparty`, `category`, `unit`, `currency`, `color-reference`, `material`, `product`, `product-module`, `product-photo`, `product-module-photo`, `product-passport`, `attribute-definition`, `entity-attribute-value`, `work-type`, `catalog` (composition-line), `document-render` (utils) → **37 модулей** из 93
- [x] Удалить транзакционный CRM-домен: `quotation`, `contract`, `order*`, `shipment`, `supply*`, `warehouse`/`storage-item`/`stock-movement`/`reservation`/`inventory`, `production*`/`work-order*`/`routing`/`tech-process`, `cost-*`/`actual-cost`/`order-closing`, `invoice`/`tender`/`desk-note`/`rpp`/`registry`/`financial-report`/`reconciliation-act`, `studio-document`/`template-block`/`text-block`/`table-template`/`document-template*`/`generated-document`/`doc-type`/`document-table-type`, `import-*`, `bom`, `cart-*`, `interaction`, `attachment`, `mutation-journal`, `comment`/`certificate`/`compliance-rule`/`inventor-file`, `work-center`/`worker`, `form-profiles`, `uploads` (только orphan-sweep DocStudio) и др. — **56 модулей удалено**
- [x] Почистить seed'ы (−6), e2e-тесты (−19), миграции (−5); decouple `database.module`/`ownership.guard`/`product-module`←cost-calculation/`rbac-contract`; **переписан `app.module.ts`** под KEEP-набор
- [x] Обновить `docs/data-model.md` (оставить только действующие сущности)
- _Критерий: `pnpm typecheck && pnpm test` зелёные; сборка образа проходит_ ✅ (typecheck 0; юнит 69/623; e2e 14/89; `nest build` 0; live: KEEP-эндпоинты 200, CRM-эндпоинты 404)
  - 📝 runtime-зависимости, пойманные только сканом populate/ref (не статическим сканом импортов): `product`+`product-module` популейтят `WorkType`, `catalog-graph` ходит по `workTypes.workTypeId` — поэтому `work-type` восстановлен из числа удалённых (канонический справочник, а не CRM). Первичная классификация была уточнена так же для `catalog`/`document-render` (нужны KEEP-домену) и обратно для `uploads` (оказался балластом).

### 6. Публичный контракт (OpenAPI)
- [x] CI/скрипт экспорта `openapi.json` в репозиторий
  - 📝 `backend/src/export-openapi.ts` + `pnpm openapi:export` → генерирует из тех же декораторов, что и Swagger UI (общая конфиг `backend/src/swagger.config.ts`, title теперь «Data Core API», не «KPPDF API»). Локальный запуск: `docker compose exec backend node dist/src/export-openapi.js /app/openapi.json && docker compose cp backend:/app/openapi.json docs/openapi.json`. В репо: **`docs/openapi.json`** (373 paths, 442 KB).
- [ ] Решить: Swagger UI под ключом в prod (`SWAGGER_ENABLED=true`) или только статический `openapi.json`
- _Критерий: любая платформа может сгенерировать клиент по файлу из репозитория_

### 7. Админка пользователей и доступов
- [x] Простой UI/API: список пользователей, создание (логин/пароль), роль «чтение / чтение+запись»
- [x] Список активных ключей с метками/TTL и кнопкой отзыва
- _Критерий: нового пользователя и ключ можно завести без БД и curl_ ✅

> 🛠 **Готово (2026-10-17):** статическая админка `backend/admin/` (vanilla JS, без сборки), отдаётся тем же NestJS на **`http://localhost:3001/admin`**. Вход по JWT, три раздела: **Пользователи** (список/поиск/создание/изменение/сброс пароля/удаление), **API-ключи** (список/TTL/выдача с одноразовым показом `kppd_`/отзыв) и **Таблицы** (справочник 91 коллекции MongoDB, сгруппирован по **12 категориям**; у каждой таблицы русское описание и тип — действующая / связевая / остаток удалённого домена; поиск по имени и описанию; строка раскрывается до полей с типами, заполненностью и маскировкой). У остатков в раскрытой строке есть кнопка **«Удалить коллекцию»** (`DELETE /api/admin/collections/:name`, подтверждение вводом имени): бэкенд пускает только **точное** имя из реестра и только `kind='legacy'` — действующие (409) и связевые (409) таблицы, а также неизвестные имена (400) удалить нельзя; дроп пишется в аудит. Смонтирована в `main.ts` (`/admin`), скопирована в Docker-образ. Проверено end-to-end в браузере: логин → пользователи → ключи → таблицы (категории, бейджи, сводка 30/6/55), включая реальное удаление остатка (91→90, тост, аудит) с восстановлением коллекции.

### 8. Деплой отдельным контуром на VM
- [x] Адаптировать `deploy/synology/deploy.*` под data-core
  - 📝 `deploy.py` переписан (без NX-фронта/desktop-installer, `/opt/data-core`, `/var/lib/datacore`, порт 3001, контейнеры `datacore-*`, `.env` с MONGO_* креденшелами, проверка Mongo-auth после деплоя); `deploy.ps1` — снят kppdf-only гейт TZ-OPS-310 (в этом репо нет `tasks/`); `preflight.ps1` — `backend/admin` вместо `frontend/src` + обязательность MONGO_*
- [x] Поднять на VM рядом с работающим kppdf: `REMOTE_DIR=/opt/data-core`, `DATA_DIR=/var/lib/datacore`, `HOST_PORT=3001`, `MONGO_PORT=27018`
  - 📝 2026-10-17: `deploy.py --wipe` → rs0 ready → backend ready → Health 200 → Auth login OK → Admin UI 200 → Mongo отклоняет неавторизованные чтения; kppdf не пострадал (:3000 отвечает). Gotcha: VM CPU Celeron J4125 без AVX → контур на `mongo:4.4`
- [x] Health-check + первый реальный ключ на прод-контуре
- _Критерий: `http://<LAN_IP>:3001/api/health/ready` отвечает, kppdf не пострадал (IP — в локальном `deploy/synology/CREDENTIALS.md`)_

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
| `deploy/synology/deploy.*` | ~~Заточены под kppdf~~ | ✅ Адаптировано под data-core (задача F): NX-фронта нет, `/opt/data-core`, порт 3001, `.env` c MONGO_*; `config.env` (секреты) в архив не попадает |
| `docker-compose.prod.yml` | Создан, но ещё не проверен реальным деплоем на VM | Задача 8 |
| MongoDB | ~~Без аутентификации (`--auth` не включён)~~ | ✅ Включено локально (задача 4): `--auth` + `--keyFile` (обязателен при rs0!), пользователи `root`/`datacore`, `backup.sh` с паролем. Повторить на VM при деплое |
| MongoDB keyfile | MongoDB **не стартует** с `--auth`+`--replSet` без `security.keyFile` (`BadValue`) | Сервис `mongo-keyfile` пишет файл (600, uid 999) в том `mongo-secrets`; `--keyFile /run/secrets/mongo-keyfile` |
| Git Bash на Windows | MSYS конвертит `/tmp/...` → Windows-путь при вызове `docker exec` → `backup.sh` падает (`Could not find the file /tmp/...`) | Локально гонять с `MSYS_NO_PATHCONV=1`; на VM (Linux) не проявляется |
| `backend/` | 92 модуля, большинство — CRM-балласт | Задача 5 |
| Swagger | ~~`openapi.json` нигде не экспортируется~~ ✅ `docs/openapi.json` экспортируется (задача 6); в prod UI выключен по-прежнему | Решить: UI под ключом или только статический файл (задача 6) |
| Версии Mongo | В prod kppdf — mongo 4.4; здесь — mongo 7 | Не смешивать контуры; не поднимать data-core на 4.4 |
| `docs/ARCHITECTURE.md`, `STACK.md` | Исторические (из kppdf), содержат упоминания CRM | Переписать после чистки модулей |
| `package.json` (backend) | `name: "kppdf-8.0-backend"`; ~~swagger-title «KPPDF API»~~ ✅ переименован в «Data Core API» (задача 6) | Переименовать `name` при чистке (задача 5/8) |
| `kppd_`-ключ и `/api/admin/users` | Ключ не несёт owner-флага → owner-admin скрыт (TZ-AUTH-306), `total:0` | Ожидаемо; для данных ключ работает. Не путать за баг |
