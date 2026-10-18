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
- `backup.sh` берёт `MONGO_ROOT_PASSWORD` из **`deploy/synology/.env` рядом со скриптом** (или из окружения), а не из `/opt/data-core/.env`, который пишет `deploy.py`. Нет переменной → `ERROR: MONGO_ROOT_PASSWORD is not set`, exit 1. `--wipe` удаляет и этот файл. Проверка: `tail /var/log/datacore-backup.log`, `ls /var/lib/datacore/backups`.
- Restore-дрилл: `mongorestore --db datacore_restore_test <дамп>/datacore` (внутри `datacore-mongo`, от root) → `verify-restore.js` → `ALL COUNTS MATCH` → удалить `datacore_restore_test`. В живую `datacore` не восстанавливать без «да» пользователя.

## Диагностика на VM

```bash
cd /opt/data-core
sudo docker compose -f docker-compose.prod.yml ps
sudo docker compose -f docker-compose.prod.yml logs --tail 100 backend
curl -sf http://localhost:3001/api/health/ready
```
Правка `.env` на VM вручную перезапишется следующим деплоем — меняй `config.env` локально. Применить без пересборки: `deploy.py --skip-build`.
