# TASKS — бэклог (единый список открытых задач)

> Источник: аудит 2026-10-18 (+ открытые пункты ROADMAP). Агент берёт задачу → делает → проверяет (skill `datacore-verify`) → ставит `[x]` с одной строкой «что сделано / как проверено».
> Приоритет: 🔴 ошибка/риск, 🟠 мусор, мешающий работе, 🟡 гигиена. 👤 = нужен пользователь (агент не делает сам).
> Базовая линия на 2026-10-18: typecheck 0; юнит 69/625; eslint `src` — 1 error / 109 warnings.

## 🔴 Ошибки и риски

- [ ] **T1. Проверки удаления смотрят в удалённые CRM-коллекции.** Удаление материала/изделия/модуля/вида работ блокируется ссылками из коллекций уничтоженного домена (`orders`, `quotations`, `costcalculations`, `purchaseorders`, `boms`, `workers`), которые в БД ещё лежат как legacy. Итог: справочную запись нельзя удалить из-за «мусорных» данных; после дропа legacy-коллекций проверки молча станут no-op.
  Файлы: `modules/material/material.service.ts:266-268`, `modules/product/product.service.ts:311`, `modules/product-module/product-module.service.ts:177`, `modules/work-type/work-type.service.ts:54`.
  Сделать: оставить только проверки по действующим коллекциям (`products`, `productmodules`, `materials`, composition-lines); поправить/добавить юнит-тесты. Готово: typecheck+юнит зелёные, в коде нет обращений к удалённым коллекциям (`grep -rn "collection('" src`).
- [ ] **T6. Тестовый эндпоинт в API.** `POST /api/internal/counter/test` (`modules/counter/counter.controller.ts`) — «удалить после TZ-17». Удалить контроллер (сервис счётчика оставить), перегенерировать `docs/openapi.json`.
- [ ] **T4a. CORS всегда пропускает Tauri/desktop-origin'ы с `credentials:true`.** `main.ts` безусловно добавляет `http://localhost:1420`, `tauri://localhost`, `http(s)://tauri.localhost` — наследие desktop-клиента kppdf, которого здесь нет. Убрать, оставить только `CORS_ORIGIN`.
- [ ] **T16. `deploy/synology/reset-admin-password.py` бьёт в прод kppdf.** Скрипт не адаптирован: `kppdf-backend`/`kppdf-mongo`, БД `kppdf`, переписывает `/opt/kppdf-8.0/.env`, проверяет `:3000`. Запуск сломает чужой контур. Адаптировать под `datacore-*`/`/opt/data-core`/`:3001` (и `.env` из `deploy.py`: `DATA_DIR`, `MONGO_*`) или удалить; до этого — не запускать (помечено в `deploy/synology/README.md`). Там же `server-setup-ubuntu.sh` — kppdf-версия (`/opt/kppdf-8.0`, `ufw allow 3000`): адаптировать или удалить.
- [ ] **T17. `backup.sh` и `deploy.py` используют разные `.env`.** `deploy.py` пишет `/opt/data-core/.env`, а `backup.sh` читает `deploy/synology/.env` рядом с собой; без него → `MONGO_ROOT_PASSWORD is not set`. Cron сейчас работает (HISTORY D), значит на VM файл/переменная заданы вручную — `--wipe` их сотрёт. Сделать: в `backup.sh` фолбэк на `$SCRIPT_DIR/../../.env` (корень `REMOTE_DIR`); проверить на VM, что cron-бэкап проходит. Деплой/правка на VM — только с согласия пользователя.

## 🟠 Наследие kppdf (балласт)

- [ ] **T2. Мёртвый код** (нигде не импортируется рантаймом; список и проверка — `docs/MAP.md`, раздел «Мёртвый код»): удалить файлы и их спеки; `jsdom`/`dompurify` + `src/common/__mocks__/` + `moduleNameMapper` в `jest.config.ts`/`test/jest-e2e.json`; `database/migrations/*` (не подключены — история есть в git). Ownership-guard/org-scope — удалить (снимет и единственную ошибку eslint). Готово: typecheck/юнит/nest build зелёные; eslint 0 errors.
- [ ] **T3. Chromium/PDF в образе.** `puppeteer-core` не используется; Dockerfile ставит `chromium` + шрифты (~сотни МБ), `main.ts` раздаёт `/fonts/*` из `assets/fonts` для PDF DocStudio (удалён). Удалить зависимость, apk-пакеты, `assets/fonts`, маршрут `/fonts`, `COPY assets` в Dockerfile; обновить lockfile (`pnpm install` / `npx pnpm@9.15.0 install`). Проверить сборку образа, если доступен Docker.
- [ ] **T4. Мусор в `main.ts`:** раздача Angular SPA (`FRONTEND_PATH`), `/downloads` desktop-инсталлятора, сообщение TZ-DOC-323 про `category` в ValidationPipe, комментарии про Angular в helmet. Удалить; поведение `/api`, `/admin`, `/uploads`, `/docs` не менять.
- [ ] **T5. Имена kppdf в конфиге:** `package.json` (`name`/`description`), дефолты `MONGO_URI`/`MONGO_DB` = `kppdf` в `config/configuration.ts`, `config/env.validation.ts`, `backend/.env.example` (→ `datacore`). **Не трогать:** префикс ключей `kppd_` (контракт), cookie `__Host-kppdf-device` (переименование разлогинит привязанные устройства — только с миграцией и с согласия пользователя), тестовую БД `kppdf-test` (можно переименовать в `datacore-test` синхронно в `test/setup/test-db.ts`).
- [x] **T7. Деплой-доки описывают kppdf.** Сделано 2026-10-18: `DEPLOY.md`/`INSTALL.md`/`RUNBOOK.md` удалены, `deploy/synology/README.md` переписан по коду `deploy.py`/`deploy.ps1`/`preflight.ps1`/`backup.sh`/`docker-compose.prod.yml` (скрипты, 6 шагов, `--wipe`, бэкапы), `CREDENTIALS.example.md` — короткий шаблон data-core. Проверено: grep мёртвых ссылок — только намеренное упоминание `docs/SECURITY-OPERATIONS.md` (T14). Найдено попутно → T16, T17.
- [ ] **T11. Висячая ссылка** `ref: 'WorkCenter'` в `modules/work-type/work-type.schema.ts:40` (модели нет). Убрать `ref` (поле оставить — данные).

## 🟡 Гигиена и документация

- [x] **T8. Неточности в `docs/CONNECT.md`.** Сделано 2026-10-18: порт `3001`; рабочий пример `POST /materials` (`name`/`article`/`unit`, лишние поля → 400); refresh — `POST /auth/refresh` с refresh-JWT в `Authorization: Bearer`/`X-Access-Token` (cookie не читается); `X-Access-Token` как альтернатива; роли admin/director/manager/user; ключ `kppd_` действует с правами выдавшего. Сверено с `modules/auth/jwt-from-request.ts`, `jwt-refresh.strategy.ts`, `material/dto`, `admin.seed.ts`, `docs/openapi.json`.
- [ ] **T12. Скрипт `pnpm lint` сломан:** глоб `test/**/*.ts` целиком в `ignorePatterns` → ESLint падает с «all files ignored». Поправить скрипт (`eslint "src/**/*.ts"`), убрать `--fix` из проверочного варианта.
- [x] **T13. Корневой `.env.example` неполный.** Сделано 2026-10-18: добавлены закомментированные `HOST_PORT=3001`, `MONGO_PORT`, `MONGO_IMAGE=mongo:4.4` с пояснениями (сверено с `docker-compose.yml`).
- [ ] **T15. Каталог прав и роли с наследием CRM.** `common/seed/permissions.constants.ts`: разделы `warehouse/procurement/sales/document/finance` и `PAGE_KEYS` для удалённого фронта ни к чему не привязаны; `work-type` защищён `production:write`. Убрать неиспользуемые ключи (проверить grep по `@Permissions` и сидам ролей; ключи в БД у ролей не ломают работу, но засоряют админку). (Таблица ролей в `docs/CONNECT.md` дополнена `director` в T8.)
- [ ] **T14. Устаревшие комментарии со ссылками на несуществующие доки** (`docs/SECURITY-OPERATIONS.md`, `tasks/…`, `frontend/…` — ~50 шт.). Низкий приоритет: править попутно, когда трогаешь файл.

## 👤 Нужен пользователь / решение

- [ ] **J1.** Подключить реальный внешний клиент (таблица/скрипт) и проверить чтение+запись ключом.
- [ ] **J2.** Копия бэкапов вне NAS (USB / второй диск).
- [ ] **J3.** Сменить дефолтный пароль админа (в админке).
- [ ] **D1.** Swagger UI в prod под ключом или только статический `openapi.json`?
- [ ] **D2.** Удалять ли 55 legacy-коллекций из живой БД (кнопка в админке «Таблицы»; сначала свежий бэкап). Связано с T1.
- [ ] **D3.** Переименовать cookie устройства `__Host-kppdf-device` (см. T5)?
