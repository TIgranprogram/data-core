# HISTORY — журнал выполненных работ (2026-10)

> Только история: что сделано и как проверялось. Открытые задачи — [TASKS.md](TASKS.md), план — [../ROADMAP.md](../ROADMAP.md).
> Агенту читать только при расследовании «почему так сделано».

## 🔥 Приоритет

- [x] **A1. Страница «Таблицы» в админке** — справочник всех коллекций MongoDB:
  - [x] A1.1 Backend: `GET /api/admin/collections` (админ-only) — список коллекций, счётчик записей, поля с типами/примерами/заполненностью
  - [x] A1.2 Admin UI: вкладка «Таблицы» — таблица, строка раскрывается и показывает поля
  - [x] A1.3 Поиск по названию **и по описанию**; описания **всех 91** коллекции (было 8 — ключ `ratelimits` не совпадал с нормализованным именем `rate_limit_entries`, баг исправлен)
  - [x] A1.4 Проверка end-to-end в браузере (91 коллекция, раскрытие users: 16 полей, маскировка `passwordHash=***`)
  - [x] A1.5 Категории и типы таблиц (2026-10-17): 12 категорий + тип `core/link/legacy` (**30 действующих / 6 связевых / 55 остатков** удалённого домена). UI: таблица сгруппирована по категориям (заголовок с счётчиком, остатки подсвечены янтарным), колонка «Описание (рус.)» сразу после имени, бейджи типов, сводка-легенда «сколько чего и можно ли удалять». Реестр `COLLECTIONS` в `collections-admin.controller.ts` — источник истины; новая коллекция без записи попадает в «Не классифицировано». verified: typecheck 0, юнит 69/623, live — 91/91 с описанием, поиск «склад» → 4 таблицы, раскрытие с бейджем
  - [x] A1.6 Удаление остатков из админки (2026-10-17): `DELETE /api/admin/collections/:name` (только admin, `user:admin` + `@Roles('admin')`, аудит `drop-collection`). Тройной предохранитель: ① имя — **точная** запись реестра `COLLECTIONS` без нормализации (иначе 400 «не описана в реестре»); ② `kind !== 'legacy'` → 409 — core/link удалить нельзя; ③ нет в БД → 404. ⚠️ Имя пишется в `details.after` аудита, а **не** в `entityId`: `AuditService.log` приводит `entityId` к `Types.ObjectId`, а имя коллекции не хекс-строка — запись молча уходила бы в `catch()`. UI: кнопка «Удалить коллекцию …» рендерится только в раскрытой строке остатка, подтверждение — вводом имени через `prompt`, затем тост + перечитывание списка и сводки. verified: typecheck **0**; юнит **69/623**; e2e **15 suites/98 tests** (новый `collections-admin-drop.e2e-spec.ts`: 401, 403, 400×2, 409×2, 404×2, успех + аудит); live Docker — 409 на `users` и `organizationcontacts`, 400 на неизвестное имя (список 91 не тронут), реальный клик в браузере 91→90 с тостом, коллекция восстановлена (0 записей, `_id_`); `docs/openapi.json` перегенерирован (**131 paths**, delete появился в `/admin/collections/{name}`)

   - [x] A1.7 Полная диагностика системы (2026-10-17, live локально + VM). Проверено по API и в реальном браузере: инфра (health ok, оба контейнера healthy, `rs0` writable primary, безавторизованное чтение данных Mongo → отказ); auth (логин 200, неверный пароль 401, `/auth/me` без токена 401, refresh 200 через `X-Access-Token`/`Bearer`, саморегистрация 410); пользователи (создание → чтение → `PATCH` → сброс пароля → старый пароль 401 / новый 200 → деактивация блокирует логин → реактивация → удаление; счётчик 1→2→1; дубль логина → 409); ключи (выдача `kppd_…` → чтение 5 ресурсов ключом → список → отзыв → 401); данные (`/products` `/materials` `/work-types` `/modules` `/organizations` `/photos`, неизвестный роут → 404); таблицы (91 коллекция, все с русским описанием, 30 core / 6 link / 55 legacy, `passwordHash` маскирован); аудит пишется; UI прогнан кликами по вкладкам «Пользователи», «API-ключи», «Таблицы»; VM — datacore healthy, kppdf-контур жив, `:3000` → 200, cron 03:00. **Найдено и исправлено 3 дефекта:**
     - 🔴 **UI: вкладка «Пользователи» была нерабочей.** API отдаёт сущности с mongoose-virtual `id`, а `admin.js` читал `u._id`. Итог: «Изменить» теряла id (диалог уходил в создание нового), «Сброс пароля» и «Удалить» уходили на `/admin/users/undefined` → `CastError` → **HTTP 500**. Исправлено: помощник `userId(u) = u.id || u._id` во всех трёх местах. Проверено в браузере после фикса: создание, изменение (id в диалоге заполнен, PATCH, новых пользователей не появилось), удаление — всё штатно.
     - 🟠 **Бэкенд: мусорный id → 500 вместо 400.** `CastError` mongoose утекал наружу (плюс полный стек в логах) на любом маршруте с `:id`. Исправлено в общем `HttpExceptionFilter`: `CastError` → **400** с сообщением «Некорректный идентификатор «…»: ожидается 24-символьный hex». Покрыто юнит-тестами (+2).
     - 🟡 **Тест-харнесс расходился с продом.** `test-db.ts` не регистрировал глобальные фильтры из `main.ts`, поэтому в e2e ошибки трактовались иначе, чем в проде (тот же `CastError` в тестах давал 500). Зарегистрированы `VersionConflictFilter`, `MulterExceptionFilter`, `HttpExceptionFilter`.
     - ⚠️ Урок по харнессу диагностики: rate-limiter — **не баг**, а защита (глобально `short` 10/1с и `long` 100/60с, у `/auth/login` свой `@Throttle` **5/60с и 20/час**). Прогон без пауз получает 429 и ничего не доказывает; проверка деактивации требует паузы ≥65 с. Второй урок: тест «удалить несуществующую легаси-коллекцию» на живой БД удаляет **существующую** — падал на `doc_types` (6 записей); восстановлено из `.data/backups/mongo-2026-10-17_1227`, деструктивные проверки из живого прогона убраны. verified: typecheck **0**; юнит **69 suites / 625 tests**; e2e **16 suites / 102 tests** (`E2E_EXIT=0`, новый `admin-users-id.e2e-spec.ts`: контракт `id` в списках пользователей и ключей, GET/PATCH/DELETE по этому id, мусорный id → 400, отзыв ключа по id из списка); `nest build` 0

## 📋 Остальное из ROADMAP (P0/P1)

- [x] **B. Mongo auth (P0.4)** — `--auth` + root/app-user в compose; бэкенд с `authSource`; 27017 не наружу
  - done: `--auth`+`--keyFile`, users root/datacore, no-auth read → rejected, LAN:27018 → False, backup.sh авторизован
- [x] **C. Restore-дрилл (P0.3)** — mongodump → восстановить в тестовую БД → данные читаются
  - done: `datacore_restore_test` 91 коллекция/107 доков → ALL COUNTS MATCH, scratch удалена
  - done (VM): дамп `mongo-2026-10-17_1055` → `106 docs restored, 0 failed` → `collections=91 srcDocs=106 restoredDocs=106` → ALL COUNTS MATCH, `admin doc readable`, scratch dropped
- [x] **D. Cron бэкапов на VM (P0.3)** — после деплоя: `0 3 * * *` + ретеншен 14 дней
  - done: на VM не было cron → `apt-get install cron`, `systemctl enable --now cron` (active); джоба `/etc/cron.d/datacore` (`0 3 * * * tiit`, ротация 14 дней), лог `/var/log/datacore-backup.log`; ручной прогон бэкапа (91 коллекция) прошёл
- [x] **E. OpenAPI экспорт (P1.6)** — скрипт экспорта `openapi.json` в репозиторий
  - done: `pnpm openapi:export` (общая swagger-конфиг с UI) → `docs/openapi.json`, 373 paths
- [x] **F. Деплой-скрипты под data-core (P1.8)** — `deploy.py`/`deploy.ps1`/`deploy.sh` без kppdf-балласта
  - done: `deploy.py` переписан (без NX-фронта/desktop-installer, `/opt/data-core`, `/var/lib/datacore`, порт 3001, контейнеры `datacore-*`, `.env` с MONGO_* креденшелами, проверка Mongo-auth после деплоя); `deploy.ps1` — снят kppdf-only гейт TZ-OPS-310 (в этом репо нет `tasks/` — он бы жёстко блокировал деплой); `preflight.ps1` — проверяет `backend/admin` вместо `frontend/src` + обязательность MONGO_* ключей; `config.env.example` переписан; архив исключает `config.env`/`CREDENTIALS.md` (проверено тестом)
- [x] **G. Деплой на VM отдельным контуром (P1.8)** — `/opt/data-core`, `:3001`, не трогая kppdf; затем cron (D)
  - done: deploy.py --wipe → rs0 ready → backend ready → Health 200 (mongo up) → Auth login OK → Admin UI 200 → Mongo rejects unauthenticated reads; kppdf untouched (Up 3h healthy, :3000=200)
  - gotcha: VM CPU Celeron J4125 без AVX → MongoDB 5.0+ (вкл.7) падает "Illegal instruction" → контур на mongo:4.4 (rs.ok=1 myState=1, MONGO_IMAGE=mongo:4.4); mongoose 8.24 совместимость доказана (test-mongoose-compat.js), скрипты шелл-агностичны (mongo vs mongosh)
  - redeploy после H (2026-10-17): `deploy.py` **без `--wipe`** (wipe стирает `/var/lib/datacore/mongodb/*`!) → backend пересобран на урезанный (37 модулей) образ; Health/Auth/Admin 200, CRM-эндпоинты → 404, KEEP → 200, Таблицы 91 коллекция (данные пережили redeploy), kppdf :3000 → 200 (Up 6h, не тронут). Актуальный пароль админа = `ADMIN_PASSWORD` из `deploy/synology/config.env` (см. gitignored `CREDENTIALS.md`); дефолт можно сменить в админке (J3)
- [x] **H. Чистка CRM-модулей (P1.5)** — оставить ядро, удалить CRM-домен; typecheck+build+тесты зелёные
  - done: граница по VISION #4 — оставлено платформенное ядро + канонические справочники (auth/user/role/permissions/setting/feature-flag/audit/desktop/rate-limit + организации/контрагенты/площадки/категории/единицы/валюты/цвета/люди/материалы/изделия/модули/фото/EAV/статусы/пропуска), удалён транзакционный CRM-домен (сделки/заказы/склад/производство/документооборот DocStudio/импорты и т.п.); итого **37 модульных директорий** из 93
  - decouple: `database.module.ts` (миграция quotation-index-hygiene), `ownership.guard.ts` (модель DocumentTemplate → pass-through null), `product-module` ← cost-calculation (эндпоинт cost-preview), `rbac-contract` ownership-матрица (убраны documentTemplate/generatedDocument/warehouse/order/contract), `LEGACY_RBAC_EXCEPTIONS` (запись registry); **`app.module.ts` переписан** под 37 KEEP-модулей + 11 сидов (охранён каркас guard/interceptor/Throttler/middleware)
  - классификация уточнена сканами: `catalog` (composition-line) и `document-render` (utils) восстановлены — нужны KEEP-домену; `work-type` восстановлен как канонический справочник (product+product-module популейтят `workTypes.workTypeId` → без него `GET /modules` и `GET /products/:id` = 500); `uploads` напротив переведён в DELETE (только orphan-sweep template-block)
  - удалено: **56 модулей** (93 → 37), 5 миграций, 6 сидов, 19 e2e (+`integration`)
  - verified: typecheck **0**; юнит **69 suites/623 tests**; e2e **14 suites/89 tests**; `nest build` **0**; live на Docker — `GET /modules`/`/work-types`/`/materials`/`/products` (list+findOne с populate WorkType) = **200**, work-types CRUD-цикл OK, 14 удалённых CRM-эндпоинтов = **404**, admin UI 200, Таблицы **91 коллекция**
  - починено 6 pre-existing e2e-падений (extraction-debt `b38e526`): DTO требует sku/article/categoryId, которых тесты не шлали; плюс 409 на delete модуля, прикреплённого к композиции (снимать composition-линию первым), и invalid-id → 404
- [x] **I. Финал** — обновить ROADMAP/README/CHECKLIST по факту
  - done: `docs/data-model.md` сужен до действующих сущностей (1827→684 строк, ~28 сущностей/7 доменов); `docs/openapi.json` перегенерирован (373→131 paths, CRM-эндпоинты убраны); README — mongo:4.4 (было 7), порты/AVX-заметка, «90→~28 сущностей», сняты устаревшие предупреждения про backup.sh/kppdf и «много CRM-домена»; ROADMAP — отмечены cron на VM (P0.3) и деплой на VM (P1.8), mongo:7→4.4, порт критерия 3000→3001
  - extra verify: жизненный цикл API-ключа `kppd_` (выдача → работает на защищённом эндпоинте → отзыв → **401**)

## 🚀 Деплой 2026-10-18 (P1 + P2 + T18 + чистка T1–T17)

- main `fcf152f` запушен на GitHub; на VM выложен **вручную по ssh** (на рабочей машине нет Python для `deploy.py`), без `--wipe`, существующие `/opt/data-core/.env` и `deploy/synology/.env` сохранены.
- Перед деплоем — бэкап `/var/lib/datacore/backups/mongo-2026-10-18_0745` (91 коллекция).
- Выкладка: `git -c core.autocrlf=false archive` (⚠ без этого флага архив на Windows получает CRLF и bash-скрипты на VM ломаются) → `backend/`, `deploy/` заменены целиком, прежние сохранены как `*.prev-202610180746` (откат: вернуть их и `docker compose -f docker-compose.prod.yml up -d --build backend`) → `docker compose build backend` (старый контейнер работал во время сборки) → `up -d --no-deps backend`; Mongo не перезапускался.
- Проверено на VM: health 200; образ 623 МБ (было 2,02 ГБ); живой сценарий внутри контейнера — ключи write/read со `apps:[smokeshop]`, create/bulk 201, фильтр+сортировка 200, PATCH 200, read-ключ пишет 403, чужое приложение 403, /admin ключом 403, `$where` 400, без ключа 401, отозванный ключ 401; `/admin/` 200; `/api/internal/counter/test` 404; Mongo без пароля → отказ; **kppdf `:3000` → 200, не тронут**. `backup.sh` (оба пути .env) отработал.
- Осталось на VM: пустая тестовая коллекция `app_smokeshop_orders` (документы удалены, ключи отозваны) — можно удалить в админке «Таблицы».

## 🌐 Публичный доступ /db/ (2026-10-18)

- По разрешению пользователя: админка научилась работать под префиксом (`PREFIX` в `admin.js`, проверено локальным прокси — логин уходит на `/db/api/auth/login`); на VM `TRUST_PROXY=1` (бэкап `.env.bak-20261018`), образ пересобран; туннель `datacore-tunnel.sh` (crontab tiit, VPS 127.0.0.1:4201 → VM :3001); на VPS бэкап `kppdf-proxy.bak-datacore-20261018`, вставлен блок `location ^~ /db/`, `nginx -t` OK, reload.
- Проверено снаружи: `/db` → 301 `/db/admin/`; `/db/admin/` 200; `/db/api/health/ready` 200; `/db/api/apps` и `/db/api/materials` без ключа 401; kppdf `/home` 401 (device-check, как раньше), `/api/health` 200, `/api/apps` 404 (это kppdf); прямые порты VPS 4200/4201 снаружи закрыты; `kppdf-tunnel` active.

## 🔗 Единая база data-core + kppdf (2026-10-18)

- По решению пользователя одна база `datacore` для всех: CRM kppdf переключён на неё, таблицы/скрипты/приложения — через API data-core.
- Анализ: в обеих базах почти не было реальных данных (kppdf: 2 пользователя, 2 материала, 2 фото, доступы устройств, сиды) → данные kppdf главные, `mongorestore --drop` (nsFrom kppdf.* → datacore.*), `app_*` не тронуты. Сверка: **все счётчики kppdf совпали** в datacore. Uploads kppdf скопированы в `/var/lib/datacore/uploads`.
- data-core: CRM-таблицы → `kind:'crm'` (удалять нельзя, только `app_*`), возвращены проверки удаления по CRM. Юнит 66/728, e2e 18/138.
- kppdf (`fb0973e9`): compose без своей Mongo, сеть `data-core_default`, `MONGO_URI` из .env (пользователь `kppdf` readWrite), deploy.py требует `MONGO_URI`, scoped-ключи отклоняются. Образ собран заранее — простой kppdf ≈ 3 мин.
- Проверено: kppdf и data-core health 200 (локально и через домен); материал, созданный через data-core, читается kppdf; удалённый через kppdf — 404 в data-core; read-ключ: data-core 200 / kppdf 401; `kppdf-mongo` остановлен, kppdf работает. Пользователь-admin общий (пароль kppdf).

## 📦 Снабжение / Склад (2026-10-18)

- [x] **Синхронизация Google-таблиц** (`deploy/google-sheets/datacore-sync.gs`): таблица → база без дублей (скрытая колонка «ID базы», хэш строки, защита от массового удаления 20%); режим зеркала база → таблица (листы «… (база)»). verified: стенд с имитацией Google на копии данных — повтор 0 изменений, сортировка 0, удаление/копия строки, блок очистки; зеркало 159/244/93.
- [x] **C1–C2. Приложение `/app`** (`backend/pwa/`): вход сотрудника, заявки и склад, фото с камеры, офлайн-очередь. verified: сценарии в браузере, офлайн при остановленном backend (ровно 1+1+1 записи после восстановления), SW в headless Edge; прод: `/db/app/` 200.
- [x] **C3. Инструмент перехода** `deploy/supply-app/cutover.js` (табличные остатки → движения `opening`, идемпотентно, темп под лимит 100/мин). verified: 208 остатков, дублей 0, повтор 0. Сам переход — за пользователем (J5 в TASKS).

- [x] **Google-таблицы читает сервер** (модуль `sheets-sync`, вкладка админки «Google-таблицы»): сервисный аккаунт, только чтение, без скриптов в таблицах. Причина: установка Apps Script у пользователя не удалась (окна ввода ключа во вкладке таблицы, правки Gemini). verified: юнит 70/747 (маппинг), e2e 22/161 (`sheets-sync.e2e-spec.ts` — Google заглушкой: доступ 403 с адресом робота, первый прогон, повтор 0, правка/очистка/удаление строки, защита от очистки листа, записи приложения целы, позиция склада подхвачена по имени); вкладка проверена в браузере.

- [x] **J1. Google-таблицы подключены на проде** (сервер читает сам): «Снабжение» + «Склад», первая загрузка 157 заявок / 120 счетов / 252 позиции / 143 движения, дублей 0. По пути: лист-копия «Снабжение» (IMPORTRANGE) во второй таблице пропускается; «Движение склада» — ключ «№», колонка «Наименование ТМЦ». Ключ робота — `/opt/data-core/secrets/google-sa.json` (600), локально `secrets/` (gitignored).

- [x] **J6. Склад и снабжение — одни данные для CRM, приложения и таблиц** (docs/UNIFY-SUPPLY-WAREHOUSE.md): общие коллекции CRM; data-core `stock` + `supply` (схемы kppdf, правила остатка kppdf), синхронизация таблиц → коллекции CRM, приложение `/app` переписано на `/api/stock` и `/api/supply`; `cutover.js` удалён (не нужен). verified: юнит 70/748; e2e 23/168; локально на реальных таблицах: 157/252/142/20 орг., повтор 0, валидация схем CRM 0 ошибок; приложение: оприходование, бронь, запись «как из CRM» видна в приложении.

## ✅ Аудит и доработки 2026-10-18 — закрытые задачи (кратко)

| Задача | Что сделано / как проверено |
|--|--|
| T1 | Проверки удаления справочников — общий `catalog/catalog-references.ts`; после объединения баз добавлен `isUsedByCrm` (ссылки из CRM kppdf снова блокируют). Юнит `catalog-delete-guards.spec.ts`. |
| T2 | Мёртвый код удалён (ownership/org-scope, pdf, snapshot, sanitize-html, migrations, jsdom/dompurify). |
| T3 | Chromium/шрифты/puppeteer убраны → образ 2,02 ГБ → 623 МБ. |
| T4, T4a | main.ts: убраны SPA/downloads/Tauri-CORS/TZ-DOC-323; CORS только из env. |
| T5 | Имена kppdf → datacore в конфиге; тестовая БД `datacore-test`. |
| T6 | Удалён `/api/internal/counter/test`; openapi перегенерирован. |
| T7, T8, T13 | Деплой-доки сведены в `deploy/synology/README.md`; CONNECT.md по факту кода; `.env.example` дополнен. |
| T11, T12 | Висячий `ref: 'WorkCenter'` убран; `pnpm lint` починен. |
| T14 | 6 мёртвых ссылок на доки в коде исправлены. |
| T15 | Каталог прав data-core 30 → 16 (kppdf досоздаёт свои — объединение). |
| T16, T17 | kppdf-скрипты reset-admin-password/server-setup удалены; `backup.sh` читает корневой .env как запасной (проверено на VM). |
| T18 | Глобальный `IdNormalizeInterceptor`: `id` рядом с `_id` во всех ответах. |
| T19 | Имя бэкапа с секундами; плюс fix: ротация удаляла свежую копию uploads (`touch` после `cp -a`). |
| T22 | Пароль root Mongo сменён после утечки в лог (`bash -x`); старый отклоняется. |
| P1 | `/api/apps/:app/:collection` — хранилище данных приложений без кода на сервере. |
| P2 | Scope ключей `kppd_`: read / write / full + apps; kppdf отклоняет ключи со scope. |
| J2 | Копия бэкапов на Windows: задача «DataCore backup pull» → `D:\datacore-backups`, 30 дней. |
| D1 | Swagger в prod выключен (контракт — `docs/openapi.json`). |
| D7, D8 | Старая база kppdf удалена (бэкап `kppdf-premerge-2026-10-18_090145` сохранён); kppdf перенесён на GitHub `TIgranprogram/kppdf-8.0`. |
| A1-connect | Вкладка «Подключение» в админке: адрес, выдача ключа, примеры (Google-таблица/Python/JS/curl), промт для ИИ со схемой; модуль `meta` (`/api/meta/schema`, `openapi.json`, `guide`), доступен любому ключу. Тексты админки: роль director, «CRM kppdf» вместо «остаток», вкладки прокручиваются на телефоне. Юнит 67/732, e2e 19/142 (+`meta.e2e-spec`). |
| A2 | Просмотр записей в «Таблицах»: переключатель «Поля / Записи», постранично (сначала новые), поиск по имени/логину/артикулу/email или id, фильтр удалённых, клик — вся запись JSON. `GET /api/admin/collections/:name/docs` (только admin, чтение сырых документов, секреты `***`, ObjectId/даты строками, длинное обрезается). Юнит +4, e2e +5 (`collections-admin-docs.e2e-spec.ts`). |
| A3 | Вкладка «Журнал»: кто/что/когда (журнал общий с kppdf), фильтры объект/действие/пользователь/период, действия по-русски, клик по id — история одной записи, по строке — подробности. `/api/audit-logs`: новые фильтры entityId/from/to, limit ≤200, мусорные параметры → 400 (было 500), details без секретов; `/audit-logs/facets`. Админка отдаётся с `Cache-Control: no-cache` (после деплоя браузер показывал старую версию). Юнит +4, e2e +5 (`audit-logs.e2e-spec.ts`). |
| A-sync | Синхронизация Google-таблиц → база (вариант A): `deploy/google-sheets/datacore-sync.gs` — листы Снабжение/Реестр счетов/Склад/Движение склада → `/api/apps/supply/*`, `/api/apps/warehouse/*`; скрытая колонка «ID базы», идемпотентное создание, патчи только изменённого (syncHash), мягкое удаление с защитой 20%, ретраи 429/5xx, свой onOpen не объявляется. Проверено на копии реальных данных в Node-стенде против локального API: 157/242 строки, повтор 0, правка 1, сортировка 0, удаление 1, копия строки 1, очистка листа — защита. |
| J4 | 5 завершённых сессий архивированы, `.claude/worktrees` удалён. |
| Прочее | Публичный доступ `https://kppdf-crm.ru/db/`; единая база data-core + kppdf; админка под префиксом; CRM-таблицы `kind:'crm'` не удаляются. |

Итоговые нормы: typecheck 0 · юнит 66/728 · e2e 18/138 · eslint 0 errors. Открытое — [TASKS.md](TASKS.md).
