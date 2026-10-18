# deploy/synology — деплой data-core на VM

> Для ИИ-агента. Сверено с кодом скриптов 2026-10-18. Порядок действий и правила безопасности — skill `datacore-deploy`.
> Реальные хост/пароли — только в gitignored `config.env` и `CREDENTIALS.md` (шаблоны: `config.env.example`, `CREDENTIALS.example.md`). Значения не выводить в чат и не коммитить.

## Контур

| | data-core (этот) | kppdf (чужой прод — **не трогать**) |
|--|--|--|
| Каталог приложения | `/opt/data-core` (`REMOTE_DIR`) | `/opt/kppdf*` |
| Данные | `/var/lib/datacore/{mongodb,uploads,backups}` (`DATA_DIR`) | `/var/lib/kppdf*` |
| API / админка | `:3001` → контейнер `:3000` | `:3000` |
| Mongo | `datacore-mongo`, `127.0.0.1:27018`, `mongo:4.4` (CPU без AVX), `--auth` + keyfile, rs0 | `kppdf-mongo` |
| Контейнеры | `datacore-backend`, `datacore-mongo` + разовые `mongo-keyfile/-init/-appuser` | `kppdf-*` |
| Compose | `docker-compose.prod.yml` | свой |

## Файлы

| Файл | Где запускать | Что делает |
|--|--|--|
| `deploy.ps1` | Windows, корень репо | Проверяет `config.env`, ставит paramiko, запускает `preflight.ps1`, затем `deploy.py`. Флаги `-SkipBuild`, `-SkipPreflight`, `-Wipe` (опасно). |
| `deploy.sh` | Linux/macOS/Git Bash | То же без preflight; аргументы пробрасываются в `deploy.py`. |
| `preflight.ps1` | Windows | python, paramiko, docker, `config.env`, наличие `backend/src`, `backend/admin/index.html`, `docker-compose.prod.yml`; `MONGO_ROOT_PASSWORD`/`MONGO_APP_PASSWORD`/`MONGO_KEYFILE_SECRET` заполнены (не `CHANGE_ME`); SSH `echo OK` (недоступен → только WARN). |
| `deploy.py` | локально (python + paramiko) | Сам деплой, 6 шагов — ниже. |
| `config.env.example` | — | Шаблон `config.env`: `DEPLOY_HOST/USER/PASSWORD/SSH_KEY`, `REMOTE_DIR`, `DATA_DIR`, `JWT_*`, `ADMIN_PASSWORD`, `MONGO_*`, `MONGO_IMAGE`, `CORS_ORIGIN`, `WIPE`. |
| `requirements.txt` | — | `paramiko`. |
| `backup.sh` | **на VM** | `mongodump` БД `datacore` от root → `DATA_DIR/backups/mongo-<дата>`, копия `uploads-<дата>`, ротация `BACKUP_RETENTION_DAYS` (14). |
| `verify-restore.js` | на VM / локально, mongo shell | Сверка счётчиков `datacore` vs `datacore_restore_test` после restore-дрилла. |

## deploy.py — что происходит

0. Читает `config.env`. **Если `JWT_*`, `ADMIN_PASSWORD`, `MONGO_*` пусты или `CHANGE_ME` — генерирует новые и только пишет WARN.** На существующих данных новые `MONGO_*` пароли не совпадут с пользователями в БД → backend не поднимется. Перед деплоем убедись, что секреты в `config.env` заполнены (preflight проверяет только `MONGO_*`).
1. Проверка исходников (`backend/src`, `backend/admin/index.html`, `docker-compose.prod.yml`).
2. Архив `backend/` + `docker-compose.prod.yml` + `deploy/` (без `node_modules`, `dist`, `.env`, `config.env`, `CREDENTIALS.md`).
3. SSH (ключ → пароль → agent); `sudo mkdir/chown REMOTE_DIR`; при `--wipe` — стирание (ниже); создание `DATA_DIR/{mongodb,uploads,backups}` (mongodb → uid 999).
4. Загрузка и распаковка архива поверх `REMOTE_DIR`; генерация `REMOTE_DIR/.env` (секреты, `MONGO_URI`, `MONGO_IMAGE`, `SWAGGER_ENABLED=false`).
5. `docker compose -f docker-compose.prod.yml down --remove-orphans` → `build backend` (кроме `--skip-build`) → `up -d`. **Даунтайм data-core на время сборки.**
6. Проверки: rs0 `ok` → `GET :3001/api/health/ready` (до 120 с; иначе печатает логи и `FAIL`) → `POST /api/auth/login` admin → `/admin/` 200 → Mongo без пароля отклоняет чтение.

Флаги: `--skip-build`, `--platform ubuntu|synology` (synology: `/volume1/docker/...`), `--host/--user/--password` (перекрывают `config.env`). `DEPLOY_SSH_KEY` из переменной окружения важнее `config.env`.

## ⚠️ `--wipe` / `-Wipe` / `WIPE=true`

Только по явному письменному «да, стереть данные» пользователя. Делает: `compose down`, `docker rm -f datacore-backend datacore-mongo`, **`rm -rf REMOTE_DIR/*`, `DATA_DIR/mongodb/*` и `DATA_DIR/uploads/*`** (бэкапы в `DATA_DIR/backups` остаются). kppdf не трогает. Включается и строкой `WIPE=true` в `config.env` — проверь, что её там нет.

## Порядок

1. Локально: typecheck + юнит зелёные (skill `datacore-verify`), всё закоммичено.
2. Если меняются схема/данные — свежий бэкап на VM: `cd /opt/data-core && bash deploy/synology/backup.sh`.
3. `.\deploy\synology\deploy.ps1` (или `python deploy/synology/deploy.py`).
4. Сверить вывод шага 6; убедиться, что kppdf `:3000` отвечает 200. Записать итог в `docs/HISTORY.md`.

## Бэкапы на VM

- Cron: `/etc/cron.d/datacore`, `0 3 * * *` от пользователя деплоя → `cd /opt/data-core && bash deploy/synology/backup.sh >> /var/log/datacore-backup.log 2>&1`.
- `backup.sh` берёт `MONGO_ROOT_PASSWORD` из `deploy/synology/.env` рядом со скриптом, а если его нет — из корневого `/opt/data-core/.env`, который пишет `deploy.py` (T17). Нет переменной нигде → `ERROR: MONGO_ROOT_PASSWORD is not set`, exit 1. Проверка: `tail /var/log/datacore-backup.log`, `ls /var/lib/datacore/backups`.
- Restore-дрилл: `mongorestore --db datacore_restore_test <дамп>/datacore` (внутри `datacore-mongo`, от root) → `verify-restore.js` → `ALL COUNTS MATCH` → удалить `datacore_restore_test`. В живую `datacore` не восстанавливать без «да» пользователя.

## Публичный доступ: https://kppdf-crm.ru/db/ (с 2026-10-18)

```
браузер/приложение → https://kppdf-crm.ru/db/...  → VPS nginx (location ^~ /db/, срезает /db)
  → 127.0.0.1:4201 на VPS → обратный туннель datacore-tunnel → VM 127.0.0.1:3001 → datacore-backend
```
- Админка: `https://kppdf-crm.ru/db/admin/`; API: `https://kppdf-crm.ru/db/api/...` (`/db` → редирект на админку). kppdf на `/` не затронут.
- Туннель: `deploy/synology/datacore-tunnel.sh` из **crontab пользователя tiit** (`* * * * *`, flock + autossh, sudo не нужен); `VPS_TARGET` — только в crontab. Проверка на VM: `pgrep -af "autossh.*4201"`. Туннель kppdf (`kppdf-tunnel`, 4200→3000) — отдельный systemd-сервис, не трогать.
- nginx: блок из `deploy/synology/nginx-datacore-db.conf` вставлен перед `location /` в `/etc/nginx/sites-available/kppdf-proxy`. **Бэкап до правки:** `kppdf-proxy.bak-datacore-20261018`. **Откат:** `cp /etc/nginx/sites-available/kppdf-proxy.bak-datacore-20261018 /etc/nginx/sites-available/kppdf-proxy && nginx -t && systemctl reload nginx`.
- Backend за прокси: `TRUST_PROXY=1` в `/opt/data-core/.env` (бэкап `.env.bak-20261018`) — rate-limit по реальному IP из `X-Forwarded-For`, который nginx перезаписывает.
- Админка сама определяет префикс (`PREFIX` в `admin.js`) — работает и на `:3001/admin`, и на `/db/admin/`.
- Порты 4200/4201 на VPS слушают `0.0.0.0` (sshd `GatewayPorts`), но снаружи закрыты фаерволом (проверено 2026-10-18). Не открывать.

## Единая база с kppdf (2026-10-18)

- kppdf-backend: `/opt/kppdf-8.0/docker-compose.prod.yml` без своей Mongo, сеть `data-core_default`, `MONGO_URI=mongodb://kppdf:<pw>@datacore-mongo:27017/datacore?directConnection=true&authSource=datacore` в `/opt/kppdf-8.0/.env` (пароль — `/opt/kppdf-8.0/.kppdf-mongo-pw`, 600; локально — в gitignored `D:\kppdf-8.0\deploy\synology\config.env`).
- **Порядок старта:** сначала контур data-core (`datacore-mongo`), потом kppdf. `down` контура data-core роняет и kppdf.
- Бэкапы до слияния: `/var/lib/datacore/backups/mongo-2026-10-18_0901` (datacore), `kppdf-premerge-2026-10-18_090145` (kppdf), `kppdf-uploads-premerge-2026-10-18_090145`. Файлы kppdf до правки: `/opt/kppdf-8.0/.env.bak-premerge`, `docker-compose.prod.yml.bak-premerge`, `desktop-pairing-key.service.ts.bak-premerge`.
- **Откат kppdf на свою базу:** `cd /opt/kppdf-8.0 && cp .env.bak-premerge .env && cp docker-compose.prod.yml.bak-premerge docker-compose.prod.yml && docker start kppdf-mongo && docker compose -f docker-compose.prod.yml up -d backend` (данные, внесённые после слияния, останутся только в datacore).
- Старая база kppdf (`/var/lib/kppdf80/mongodb`, контейнер `kppdf-mongo` — остановлен) **не удалять без подтверждения пользователя** (TASKS D7).

## Диагностика на VM

```bash
cd /opt/data-core
sudo docker compose -f docker-compose.prod.yml ps
sudo docker compose -f docker-compose.prod.yml logs --tail 100 backend
curl -sf http://localhost:3001/api/health/ready
```
Правка `.env` на VM вручную перезапишется следующим деплоем — меняй `config.env` локально. Применить без пересборки: `deploy.py --skip-build`.
