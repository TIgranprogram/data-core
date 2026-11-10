# C058 — DIAG (шаг 0, только чтение) · 2026-11-10 ~20:45 UTC

**Вердикт:** автосинхронизация 15 мин и кнопка «Переключить» **не работают**, потому что **механизм не включён (A1)**. Код на проде есть (обзор `/api/control/switch` отвечает). Запись на серверы не делалась.

Цель «копия ≤ 15 мин» сейчас **не выполняется** (возраст ~3–4 ч после ручного/суточного пути с ПК).

---

## Сводка фактов

| Узел | Жив | Версия | HA_SELF | Мост (alive / cron) | Копия |
|--|--|--|--|--|--|
| Дом (VM / прод) | health ok | `v1.684 · 83cc0255` | **нет** | **нет** / cron switch-watch **нет** | каталог `switch/` пуст |
| Sportin | health ok, `:8080` открыт | ping `version:null` | **нет** (0 строк в `.env`) | **нет** alive / cron switch-watch **нет** | `last-refresh` **2026-11-10T16:53:54Z** |
| VPS | — | — | — | `dc-switch` **есть**, nginx `proxy_pass http://datacore_db/` | туннель Sportin cron `REMOTE_PORT=4203` **есть** |

`dc start` (локально): копии «дом 7 ч · Sportin 17 ч · ПК 4 ч»; ИИ-тестировщик чист; 3 ошибки сайта за сутки (products/salesorders) — к переключателю не относятся.

---

## Точные причины (причина → доказательство)

### 1. Главная: `HA_SELF` не задан → переключение и автообновление выключены

**Следствие:** `enabled:false`; таймер `autoRefresh` не ставится; заявки refresh каждые 15 мин не создаются (код: `switch.service.ts` — без `HA_SELF` сервис «ничего не делает»).

**Доказательства:**
- Дом `GET /api/control/switch` (api.sh prod, 2026-11-10T20:42:33Z):
  ```json
  {"enabled":false,"self":null,"version":"v1.684 · 83cc0255",
   "peer":{"configured":true,"healthy":true,"version":null,"role":null,"copyAgeMin":229,"checkedAt":"2026-11-10T20:42:33.937Z"},
   "bridge":{"alive":false},
   "blockers":["Этому серверу не задано, какой он: домашний или офисный.","Служебный мост переключения на этом сервере не запущен."],
   "canStart":false,"canRefresh":false,"canEmergency":false}
  ```
- Дом ping: `{"self":null,"role":null,"version":"v1.684 · 83cc0255","copyAt":null,…}`
- SSH VM read-only: в контейнере `datacore-backend` — `HA_SELF=absent`, `HA_PEER_URL=present len=26`
- SSH Sportin: в `.env` строк `HA_SELF=` = **0**; в контейнере `HA_SELF` absent; `HA_PEER_URL` строк = 1

Это и есть A1 (`setup-switch.sh --enable`) — **не сделан**.

### 2. Мост `switch-watch` не запущен (нет cron, нет heartbeat)

**Следствие:** даже после появления `HA_SELF` кнопка «Обновить»/«Переключить» не выполнит работу без моста; `bridge.alive:false`.

**Доказательства:**
- API Дом: `bridge.alive:false` + blocker «мост … не запущен»
- VM: `/var/lib/datacore/switch/` существует с 31.10, **пустой** (`last-refresh` и `alive` — missing); `/host-switch` пуст
- VM `crontab`: есть туннель/`VPS_TARGET`, **нет** `switch-watch`
- Sportin `crontab`: есть `datacore-tunnel.sh` `REMOTE_PORT=4203`, **нет** `switch-watch`; файл `alive` отсутствует
- На обоих хостах файл `switch-watch.sh` на диске **есть** (`WATCH_PRESENT`) — просто не поставлен в cron

### 3. «Автосинхронизация не работает» — не баг таймера, а выключенный контур + только суточный запасной путь с ПК

По замыслу C042-A3 главный сам ставит refresh каждые 15 мин **только если** `HA_SELF` + мост жив + сосед healthy. Сейчас условие ложно → авто 15 мин **молча не стартует**.

Запасной путь (ПК) жив, но это **раз в сутки**, не 15 мин:
- Задача Windows `\DataCore copy refresh`: Enabled, Daily 11:00, Last Run **10.11.2026 19:52:45**, Last Result **0**, команда `bash SRV-ERP/refresh-copy.sh` (без `--code`)
- Sportin `last-refresh` = **2026-11-10T16:53:54Z** (= 19:53 MSK) — совпадает с Last Run задачи
- Возраст копии с Дома в момент опроса: `copyAgeMin:229` (~3 ч 49 мин) — уже **≫ 15 мин**
- Лог `D:\datacore-backups\refresh.log`: последние успешные прогоны до 08.11; в логе также сбои архива (03.11 tar, 06.11 Unexpected EOF) и DNS `sportin.netcraze.pro` после успешного прогона 08.11 — **не сегодняшняя причина**, но хвост хрупкости ПК-пути

**Вывод:** пользователь видит «не обновляется само каждые 15 мин» — верно. Обновление сегодня было только запасным путём с домашнего ПК.

### 4. A1/подготовка: VPS и туннель уже частично стоят; enable — нет

| Что | Статус | Доказательство |
|--|--|--|
| `dc-switch` на VPS | есть | SSH через VM: `DC_SWITCH_OK` |
| nginx `/db/` → `datacore_db` | есть | `proxy_pass http://datacore_db/;` (стр. ~98) + файл `datacore-upstream.conf` |
| Туннель Sportin→VPS :4203 | cron есть | Sportin crontab `REMOTE_PORT=4203` |
| `bridge.env` на Sportin | файл есть (не читали) | `ls /var/lib/datacore/switch/` |
| `HA_SELF` + cron моста | **нет** | причины 1–2 |
| `setup-switch.sh --enable` | **не выполнен** | следует из 1–2 |

То есть «подготовка» (без `--enable`) похоже уже делалась; **включение A1 — нет**.

### 5. A4 не закрыт: прямой `:8080` Sportin снаружи доступен

- `curl.exe http://31.222.224.247:8080/api/health` → 200, backup last `2026-11-10T03:30:00`, ageHours **17**
- `GET /api/control/switch` без JWT → **401** (маршрут есть)
- `GET /api/control/switch/status` → 404 (такого пути нет; верный — `/api/control/switch`)

### 6. Версии / код на запасном

- Дом: `version.json` через `https://kppdf-crm.ru/db/app/version.json` → `{"v":"ecffe97e","n":684,"b":"83cc0255","date":"2026-11-10T16:52:42+03:00"}`
- Sportin ping: `version:null` при живом `copyAt` — на обзоре Дома `peer.version:null`. Для A5/кнопки после enable нужна сверка версий; сейчас без enable блокер версий не главный.
- Авто с ПК **без `--code`** — база/фото да, код на Sportin этим путём не подтягивается (C045 🟡4).

### 7. Хвосты C045 (ещё не в коде прод-контура как «тревога»)

- C045-6: тревога «копия старше N» — в очереди TASKS; сейчас возраст 229 мин виден только в API/экране, отдельной тревоги в `dc data` нет.
- C045-8: сверка «наших» коллекций — в очереди; к шагу 0 не блокер диагноза.

---

## Что точно НЕ является текущей причиной «не работает»

- Падение Mongo/health на Доме или Sportin — оба `status:ok`.
- Отсутствие кода переключателя на Доме — маршрут обзора отвечает полями C042/C045.
- Отсутствие `dc-switch`/upstream на VPS — они на месте.
- «Сломанный» Windows-задачей путь как единственный — он сегодня отработал (last-refresh); проблема в том, что **основной** 15-мин контур выключен.

---

## Команды шага 0 (журнал)

| # | Команда / источник | Итог |
|--|--|--|
| 1 | `tools/dc.cmd start` | хук ок; main sync; ошибок сайта 3; Sportin копия 17 ч |
| 2 | `api.sh prod GET /api/health` (+ ready) | ok, backup ageHours 7 |
| 3 | `api.sh prod GET /api/control/switch/status` | тело 404 (неверный путь) |
| 4 | `api.sh prod GET /api/control/switch` | enabled:false, copyAgeMin:229, bridge false |
| 5 | `api.sh prod GET /api/control/switch/ping` | self null, version v1.684 |
| 6 | `curl Sportin /api/health` | ok, backup ageHours 17 |
| 7 | `curl Sportin /api/control/switch/ping` | copyAt 16:53:54Z, version null |
| 8 | SSH VM: env HA_*, ls switch/ | HA_SELF absent; switch пуст |
| 9 | SSH Sportin: HA_SELF count, last-refresh, cron | HA_SELF 0; last-refresh есть; нет switch-watch cron |
| 10 | SSH VM→VPS: dc-switch, nginx | DC_SWITCH_OK; datacore_db |
| 11 | `schtasks` DataCore copy refresh | Enabled, last 19:52 result 0 |

Секреты (`.env`, `bridge.env`, ключи) не читались и не выводились.

---

## Что чинить дальше (вход в шаг 1 PLAN — без записи до «да»)

1. **A1** — `setup-switch.sh --enable` на оба + перезапуск backend → `enabled:true`, cron моста, `alive`.
2. Доказать **авто refresh 15 мин** двумя отметками `last-refresh` / экраном «Серверы».
3. **A4** — закрыть прямой `:8080`; сверка хешей секретов.
4. При необходимости **`--code`** на Sportin, чтобы версии совпали.
5. **A7** — учебное переключение ночью по чек-листу C045.
6. Хвосты C045-6/8.

**Не говорить «работает» до A7.**
