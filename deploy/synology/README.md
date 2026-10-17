# Deploy — KPPDF 8.0 (Synology VM)

> **Одна точка входа для деплоя.** Секреты не в git: `CREDENTIALS.md` + `config.env`.  
> **Последний успешный warm deploy:** 2026-08-27 · код `4d55d0ea` · prod `https://kppdf-crm.ru`.  
> **Цель UI:** после cutover — **NX** (`frontend-nx` → staging `frontend/browser/`). Канон: [`docs/ops/DEPLOY-NX-PROD.md`](../../docs/ops/DEPLOY-NX-PROD.md).  
> Пока `DEPLOY-READY.status != READY` или `frontend_target != nx` — деплой **STOP** (prep: `tasks/PROMPT-CLAUDE-DEPLOY-PREP-NX.md`).

---

## Если PO сказал: «сделай деплой по документации»

Сделай **только** это. Не ищи другие промпты. Не гоняй jest/tsc. Не чини код.

1. Папка проекта: `D:\kppdf-8.0`, ветка `main`.
2. Открой [`docs/agent-checklists/DEPLOY-READY.md`](../../docs/agent-checklists/DEPLOY-READY.md).
   - Если `status` **не** `READY` → **STOP**. Напиши PO: «штамп не READY — нужна подготовка к деплою».
   - Если `READY`, но `frontend_target` не `nx` → **STOP** (устаревший legacy-штамп).
   - Если `READY` + `frontend_target: nx` → `git fetch origin` && `git checkout main` && `git pull --ff-only`.
   - Проверка SHA: `deploy_sha_target` должен быть **предком** `HEAD`
     (`git merge-base --is-ancestor <deploy_sha_target> HEAD`). Обычно tip = target
     или tip = target + 1 docs-коммит штампа. Иначе **STOP**.
   - Деплой всегда с **tip `main` (HEAD)**, не detached на старый SHA.
3. VPN **выключен**. Секреты уже в `deploy/synology/config.env` + `CREDENTIALS.md` (не коммитить, пароли не печатать).
4. Wipe: смотри штамп `wipe_default`. Канон NX = **warm** (`false`).  
   `-Wipe` только после бэкапа и фразы PO `да, разрешаю wipe после бэкапа` (`docs/ops/DANGEROUS-OPS.md`).
5. Warm deploy (данные не трогать, **без** wipe):

```powershell
cd D:\kppdf-8.0
$env:PYTHONUTF8='1'
$env:PYTHONIOENCODING='utf-8'
.\deploy\synology\deploy.ps1
```

6. Жди блок `=== Deploy complete ===` (~10–20 мин; NX build дольше legacy).
7. Smoke (логин/пароль из `CREDENTIALS.md`, в чат не писать) + NX UI checks из `docs/ops/DEPLOY-NX-PROD.md` §4:

```powershell
curl.exe -sf http://192.168.1.52:3000/api/health/ready
curl.exe -sf -u "LOGIN:PASS" https://kppdf-crm.ru/api/health/ready
curl.exe -sf -u "LOGIN:PASS" -o NUL -w "%{http_code}" https://kppdf-crm.ru/
```

8. Отчёт PO: SHA + «warm NX deploy OK» + health. В `DEPLOY-READY.md` поставь `status: INVALID` и `why_invalid: deployed <sha> <date>`, закоммить штамп.

Запрещено: wipe без фразы PO, второй параллельный deploy, коммит секретов, «заодно» новые TZ.

---

## Подготовка (это не деплой)

PO говорит Cursor: **«подготовь к деплою»**.  
Для **NX-сайта**: `tasks/PROMPT-CLAUDE-DEPLOY-PREP-NX.md` + `TZ-OPS-DEPLOY-NX-STATIC`  
(переключить `deploy.py` на `nx build kppdf-web`, гейты, штамп READY). Прод не трогают.  
Общий чек-лист гейтов: `tasks/PROMPT-DEPLOY-READY.md`. Канон: `docs/ops/DEPLOY-NX-PROD.md`.  
Постмортем: `docs/audits/2026-08-23-deploy-block-desk423-stale-specs.md`.

| Файл | Зачем |
|------|--------|
| **`deploy.ps1`** / **`deploy.sh`** | Запуск деплоя одной командой |
| **`deploy.py`** | Реальная логика (build → SSH → docker) |
| **`config.env.example`** | Шаблон → `config.env` |
| **`CREDENTIALS.example.md`** | Шаблон → `CREDENTIALS.md` |
| **`RUNBOOK.md`** | 502, бэкап, VPN |
| **`DEPLOY.md`** | Архитектура |
| **`INSTALL.md`** | Установка с нуля |
| **`preflight.ps1`** | Проверки (+ OPS-310) |
| **`backup.sh`** | Бэкап Mongo на VM |

Скрипт: `pnpm` build FE → архив → SSH на VM → `docker compose` → health.  
Данные Mongo **не** трогает (`WIPE=false`).

```powershell
.\deploy\synology\deploy.ps1
# или: ./deploy/synology/deploy.sh
# или: python deploy/synology/deploy.py
```

---

## Первый раз на этой машине (5 минут)

```powershell
pip install -r deploy/synology/requirements.txt
copy deploy\synology\config.env.example deploy\synology\config.env
copy deploy\synology\CREDENTIALS.example.md deploy\synology\CREDENTIALS.md
# заполнить config.env + CREDENTIALS.md; SSH-ключ в config.env
.\deploy\synology\deploy.ps1
```

Preflight: `.\deploy\synology\preflight.ps1`

---

## Флаги

| Команда | Смысл |
|---------|--------|
| `.\deploy\synology\deploy.ps1` | Update (без wipe) |
| `.\deploy\synology\deploy.ps1 -Seed` | Update + restart bootstrap seeds |
| `.\deploy\synology\deploy.ps1 -Wipe -Seed` | **Снос** app+mongo и чистая установка |
| `.\deploy\synology\deploy.ps1 -SkipBuild` | Без пересборки Angular |

> **`-Wipe` только пока система не в реальной работе.** Когда PO скажет «работаем» — wipe запрещён.

### Как устроен быстрый путь (канон)

1. **NX собирается `deploy.py`** (`cd frontend-nx && pnpm exec nx build kppdf-web` → copy в `frontend/browser/`).  
   `TZ-OPS-DEPLOY-NX-STATIC` закрыт — `build_frontend()` больше не вызывает legacy `pnpm --dir frontend build`.
2. В tar уходит: `backend/` + `frontend/browser/` + `docker-compose.prod.yml`.
3. На VM: `docker compose build backend` **с кэшем** → `up -d` (mount `frontend/browser` без смены).
4. **Не** два деплоя параллельно; `--no-cache` — исключение.

---

## После клона репо

1. `pip install -r deploy/synology/requirements.txt`
2. Скопировать `config.env.example` → `config.env`, `CREDENTIALS.example.md` → `CREDENTIALS.md`.
3. VPN off → после штампа READY: `.\deploy\synology\deploy.ps1`

Деплой только с ПК в домашней LAN. GitHub = только хранилище (`docs/GIT-POLICY.md`).

---

## Desktop installer (TZD-16 / TZD-24 / TZD-46)

После `cd desktop && pnpm tauri build` → `pnpm run publish-installer`  
(в `frontend/downloads/`). Имена: `kppdf-desktop-setup-v{semver}.zip` + alias.  
Канон: `docs/audits/2026-08-12-desktop-download-version-naming-canon.md`.  
Не коммитить `.exe`/`.zip`. Свежесть zip проверяется на подготовке к деплою.

### На warm с актуальным Desktop AI

1. Свежий `tauri build` + `publish-installer` (если штамп требует).
2. `config.env`: `DESKTOP_*` / `DESKTOP_DOWNLOAD_URL`.
3. Smoke: имя zip содержит `v{semver}`.

## Данные переживают деплой

Volumes на хосте. Удаляет **только** явный `--wipe` + разрешение PO + бэкап.

---

## После деплоя — проверка

```
https://kppdf-crm.ru/
https://kppdf-crm.ru/api/health/ready
```

Логин admin — только из `CREDENTIALS.md`. Стили «голые» → Ctrl+F5. 401 → пароль/softlock.

---

## Уроки деплоев (сжато)

1. VPN off перед SSH `192.168.1.52`. Домен: `kppdf-crm.ru`.
2. `main == origin/main`, дерево чистое.
3. Windows: `$env:PYTHONUTF8='1'` перед `deploy.ps1`.
4. Один деплой за раз; кэшированный docker build по умолчанию.
5. Не коммитить `config.env` / `CREDENTIALS.md`.
6. После wipe нужен replica set (уже в compose).

### Smoke

```powershell
curl.exe -sf http://192.168.1.52:3000/api/health/ready
# UI: https://kppdf-crm.ru/ — Ctrl+F5, login из CREDENTIALS.md
```

### Если VM «мёртвая»

```powershell
$env:PYTHONUNBUFFERED='1'
python -u deploy/synology/deploy.py --skip-build   # если FE уже собран
# или: .\deploy\synology\deploy.ps1
```
