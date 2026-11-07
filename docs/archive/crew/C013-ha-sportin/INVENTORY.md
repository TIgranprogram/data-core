# C013 — инвентарь «два сервера» (только репо + этот ПК)

Проверено чтением файлов 2026-11-03. На прод и Sportin команды не слались. Секреты не читались.

## Как устроено сейчас (одна фраза)

Два независимых Mongo. Домен смотрит на дом. Sportin — холодная копия: дамп дома → ПК → `mongorestore` на Sportin. Это не журнал репликации.

## Код кнопки «кто главный»

| Путь | Зачем |
|--|--|
| `backend/src/modules/control/switch/switch.service.ts` | Роль main/standby, пауза записи, заявка мосту. Без `HA_SELF` в базу не ходит. |
| `backend/src/modules/control/switch/switch.rules.ts` | Правила: копия старше 26 ч — рано переключать; мост молчит 3 мин — бросить работу. |
| `backend/src/modules/control/switch/switch.controller.ts` | `GET /control/switch` (admin), `POST start`, `POST emergency` (фраза). `ping` и `report` без входа. |
| `backend/src/modules/control/switch/switch.middleware.ts` | В режиме readonly запись → 503 `READ_ONLY`. |
| `backend/src/modules/control/switch/*.spec.ts` | Юнит: выключено без `HA_SELF`, 503, захват работы, отчёт моста. |
| `backend/src/app.module.ts` (~280) | Подключает паузу записи. Без `HA_SELF` сайт как раньше. |
| `docker-compose.prod.yml` (~162, ~171) | Прокидывает `HA_SELF` и папку `${DATA_DIR}/switch` в контейнер. |
| `backend/admin/index.html`, `control-switch.js`, `control-switch.css` | Вкладка «Серверы»: обзор, «Переключить сейчас», аварийный подъём. |
| `backend/pwa/core/api.js`, `core/write-retry.js`, `main.js` | Повтор записи до 3 мин с одним `Idempotency-Key`, текст «Нет соединения…». |
| `docs/MAP.md` (строка `control`) | Контракт маршрутов центра контроля, включая switch. |

`HA_ENABLED`, `GET /api/health/role`, `isMaster` в `backend/src` — нет. Это пункты HA-7, не сделаны.

## Хост: переключение домена и копия

| Путь | Зачем |
|--|--|
| `deploy/ha/switch/dc-switch.sh` | На VPS меняет upstream `/db/`: дом = порт 4201, Sportin = 4203. Сам по здоровью не переключает. |
| `deploy/ha/switch/switch-watch.sh` | Cron раз в минуту. Без файла-заявки домен не трогает. Заявка: пауза → дамп → передача → сверка 5 коллекций → `dc-switch`. Авария: только смена домена, база не догоняется. |
| `SRV-ERP/setup-switch.sh` | Один раз ставит ключи, `dc-switch`, `bridge.env`. `--enable` пишет `HA_SELF` и cron. На проде, по докам, не запускался. |
| `SRV-ERP/setup-tunnel.sh` | Туннель Sportin → VPS:4203. Домен не меняет. Запуск — человек. |
| `SRV-ERP/refresh-copy.sh` | С ПК заливает последний `datacore-*.tgz` на Sportin (`mongorestore --drop`). `--code` — ещё код из HEAD. Отказывается, если Sportin не запасной. |
| `SRV-ERP/register-refresh-task.ps1` | Задача Windows «DataCore copy refresh», 11:00, только база и фото, без `--code`. |
| `deploy/backup-pull/register-task.ps1` | Задача «DataCore backup pull», 10:00: дом → папка на ПК. Первое звено цепочки. |
| `SRV-ERP/backup-erp.sh` | Ночной дамп самого Sportin (03:30), хранит 3. Не копия дома. |
| `SRV-ERP/backup-now.sh` | Тот же бэкап сразу. |
| `SRV-ERP/restore-drill-erp.sh` | Учебное восстановление во временную базу. 2026-10-31: 136 таблиц. |
| `SRV-ERP/push-smb.sh` | Ставит на Sportin ночной бэкап и отправку на NAS. |
| `SRV-ERP/README.md` | Стенд друга: копия для просмотра, не резерв с автопереключением. Правило: код прода ради стенда не править. |
| `deploy/ha/lab/` (`lab.mjs`, compose) | Макет replica set на ПК. Итог — архив ниже. |

`deploy/ha/README` — нет.

## Пульт

`pult/catalog.mjs` — кнопки: обновить версию (`refresh-copy.sh --code`), только база, автообновление 11:00, бэкап Sportin, NAS, учебное восстановление, адрес соседа на доме.  
`pult/todo.json` — пункты `task-pull`, `task-refresh` всё ещё пишут «Sportin обновляется только вручную». На этом ПК это уже неправда (см. отчёт).  
`pult/docs/КОМАНДЫ.md`, `pult/README.md` — те же кнопки словами.

## Документы и задачи

| Путь | Зачем |
|--|--|
| `docs/roles/tz/HA-TWO-SERVERS.md` | Целевое ТЗ: replica set, сторож, кнопка. Чек-лист Э0–Э7 и SW-1…7. Внутри три разные схемы, они спорят. |
| `docs/archive/audit/HA-LAB-RESULTS.md` | Макет 2026-10-31. Чистый обрыв главного — потерь 0. Обрыв канала и затем смерть главного — потеряно ~30 % подтверждённых записей. Автомат без защиты запрещён. |
| `docs/audit/SERVERS-STATUS.md` | Снимок 2026-11-01: задача Windows «не подтверждена», `HA_SELF` выключен, SW-7 нет. Устарело по задаче Windows. |
| `docs/audit/AUDIT-ADMIN-2026-10-31.md` | Цепочка дом → ПК → Sportin → NAS. Галочки расписаний ПК были пустые. |
| `docs/audit/AUDIT-ADMIN-PULT-2026-11-01.md` | Вкладка «Серверы» без `HA_SELF` не переключает. |
| `docs/BACKLOG.md` | п.0 CRM отключить (решение есть, кнопка не нажата); 0а порядок SW-7; 8 пароль; 9 память; 10 замеры HA-2. Большое направление п.2 — ТЗ HA. |
| `docs/TASKS.md` (~151, ~163, ~303) | Переключатель L; XL replica set; Sportin «копий нет» — пункт старый, бэкап 31.10 уже был. |
| `docs/QUESTIONS.md` (~26) | CRM пишет мимо паузы. Сколько копий хранить. |
| `docs/HISTORY.md` | 31.10: Sportin обновлён с `--code` (код `695d89c`). v1.384: вкладка «Серверы», без `HA_SELF`. 03.11: прод v1.481. |
| `docs/roles/maps/backend.md` (~126) | Якорь SW: мост гоняли на заглушках; `setup-switch.sh` на серверах не запускался. |
| `AGENTS.md` п.10 | Дом и Sportin — один код. Чужой сервер — только папка `SRV-ERP/`. Прод по умолчанию не менять. |

## Этот ПК (чтение планировщика, без записи)

Задачи есть, режим входа «только интерактивно» (без входа пользователя не стартуют):

- `DataCore backup pull` — сегодня 10:00, код 0.
- `DataCore copy refresh` — сегодня 11:00, код 2. Лог `D:\datacore-backups\refresh.log`: 1 и 2 ноября копия доехала (health 200). 3 ноября распаковка `datacore-2026-11-03_030001.tgz` оборвалась (`tar: lone zero block`). Sportin остался на копии 2 ноября.

## Чего в репо нет

Сторож, который сам переключает домен при пропадании света. Replica set между домом и Sportin. WireGuard, арбитр, `HA_ENABLED`. Обратная ежедневная копия Sportin → дом. Автообновление кода Sportin (в задаче 11:00 флага `--code` нет).
