---
name: datacore-deploy
description: Безопасный деплой data-core на Synology/Ubuntu VM рядом с работающим прод-контуром kppdf. Использовать, когда пользователь просит задеплоить, обновить сервер, проверить VM или бэкапы на VM.
---

# Деплой на VM

Деплой — действие на внешнем сервере: **только по явной просьбе пользователя**, перед запуском одной строкой скажи, что будет сделано.

## Факты
- VM: Ubuntu на Synology, CPU без AVX → `mongo:4.4`. Хост/доступ — в gitignored `deploy/synology/CREDENTIALS.md` и `config.env` (читать можно, значения в чат и в коммиты не выносить).
- data-core: `/opt/data-core`, данные `/var/lib/datacore`, API `:3001`, контейнеры `datacore-*`, compose `docker-compose.prod.yml`.
- Рядом **прод kppdf** (`:3000`) — не трогать, не останавливать, не пересобирать. **Единая база:** kppdf работает с нашей `datacore-mongo` → никогда не останавливай/не пересоздавай `datacore-mongo` без нужды и не делай `compose down` контура data-core (kppdf упадёт). Обновлять backend: `build backend` → `up -d --no-deps backend`.
- Бэкап: cron `/etc/cron.d/datacore` 03:00 → `deploy/synology/backup.sh`, лог `/var/log/datacore-backup.log`, ротация 14 дней.

## Запуск (Windows, из корня репо)
```powershell
.\deploy\synology\deploy.ps1            # preflight + deploy.py (нужен python + paramiko)
```
или напрямую `python deploy/synology/deploy.py` (`py` если `python` нет в PATH). Флаги: `--skip-build`.
**`--wipe` / `-Wipe` ЗАПРЕЩЁН** (в `deploy.py` блокируется, снять — только `FORCE_WIPE_UNIFIED=yes` по письменному решению пользователя; сотрёт и данные kppdf) без явного письменного «да, стереть данные»: удаляет `/opt/data-core/*`, `/var/lib/datacore/mongodb/*` и `uploads/*`. Строка `WIPE=true` в `config.env` включает то же самое.

## Если нет Python (ручной деплой по ssh — проверен 2026-10-18)
Архив только так: `git -c core.autocrlf=false archive --format=tar.gz -o release.tgz HEAD backend docker-compose.prod.yml deploy` (иначе CRLF → bash на VM ломается). На VM: распаковать во временную папку, скопировать туда `deploy/synology/.env`, старые `backend/` `deploy/` переименовать в `*.prev-<дата>`, новые положить на место; `.env` в корне не трогать. Затем `docker compose -f docker-compose.prod.yml build backend` → `up -d --no-deps backend`. sudo на VM требует пароль — не нужен, docker доступен пользователю. История — `docs/HISTORY.md`.

## С работы (не из домашней сети)
VM `192.168.1.52` напрямую недоступна → вход через VPS: `bash remote-access/deploy.sh` (тот же `release.sh`, `VM=datacore-vm`, ключ `~/.ssh/datacore_work`, ProxyJump через `kppdf-crm.ru`). Настройка ПК и связь — `remote-access/README.md`, `bash remote-access/check.sh`. Если `check.sh` пишет «порт 22 закрыт» — выложить нельзя, скажи пользователю (вариант: интернет с телефона). Отзыв ключа и устройство туннеля — `deploy/synology/README.md` «Выкладка с работы». GitHub Actions/автодеплой через GitHub пользователь **не хочет** (плохой опыт: платно, блокировка) — не предлагать.

## Перед деплоем
1. `release.sh` сам запускает ворота `deploy/synology/preflight.sh`: закоммичено и запушено, tsc + юнит, импорты приложения, метки `Дизайнер:` / `Класс:` (CLAUDE.md). СТОП — чинить причину, не обходить; `--force-urgent` — только если сайт уже сломан.
2. Секреты (`JWT_*`, `ADMIN_PASSWORD`, `MONGO_*`) в `config.env` заполнены: пустые/`CHANGE_ME` `deploy.py` молча сгенерирует заново → на живых данных backend не подключится к Mongo.
3. Если меняется схема/данные — свежий бэкап на VM (`bash deploy/synology/backup.sh` там же).

## Индексы на проде (М6, скорость С6)
На проде `autoIndex` выключен: новый `index: true` / `Schema.index()` сам не создаётся. Добавил индекс → после выкладки:
`docker cp backend/scripts/ensure-indexes.js datacore-backend:/app/scripts/` → `docker exec datacore-backend node scripts/ensure-indexes.js` (план) → `--apply`. Скрипт только создаёт недостающие (без удаления — индексы CRM на общих коллекциях не трогает); новую модель — дописать в `MODELS`.

## После деплоя (deploy.py проверяет сам, сверь вывод)
`/api/health/ready` 200 → логин OK → `/admin` 200 → Mongo отклоняет неавторизованное чтение → kppdf `:3000` по-прежнему 200. Итог записать в `docs/HISTORY.md`.

Что делает каждый скрипт и шаг `deploy.py` — `deploy/synology/README.md`. Пароль админа меняется в админке (Пользователи → Сброс пароля).
