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

## Запуск (единственный путь)
```bash
bash deploy/synology/release.sh        # с домашнего ПК
bash remote-access/deploy.sh           # с работы (тот же release.sh через VPS)
```
Данные не стирать: база общая с CRM kppdf, никаких wipe / `rm -rf` каталогов данных без письменного «да» пользователя.

## С работы (не из домашней сети)
VM `192.168.1.52` напрямую недоступна → вход через VPS: `bash remote-access/deploy.sh` (тот же `release.sh`, `VM=datacore-vm`, ключ `~/.ssh/datacore_work`, ProxyJump через `kppdf-crm.ru`). Настройка ПК и связь — `remote-access/README.md`, `bash remote-access/check.sh`. Если `check.sh` пишет «порт 22 закрыт» — выложить нельзя, скажи пользователю (вариант: интернет с телефона). Отзыв ключа и устройство туннеля — `deploy/synology/README.md` «Выкладка с работы». GitHub Actions/автодеплой через GitHub пользователь **не хочет** (плохой опыт: платно, блокировка) — не предлагать.

## Перед деплоем
0. Путь выбирается сам: «быстрый» (только экраны, секунды, без пересборки) или «полный»; `bash deploy/synology/release.sh --dry-run` — показать, какой будет. Подробно — `deploy/synology/README.md` «Два пути выкладки».
1. `release.sh` сам запускает ворота `deploy/synology/preflight.sh`: закоммичено и запушено, tsc + юнит, импорты приложения, метки `Дизайнер:` / `Класс:` (CLAUDE.md). СТОП — чинить причину, не обходить; `--force-urgent` — только если сайт уже сломан.
2. Секреты (`JWT_*`, `ADMIN_PASSWORD`, `MONGO_*`) в `/opt/data-core/.env` на VM не менять и не пересоздавать: пустые значения → backend не подключится к Mongo.
3. Если меняется схема/данные — свежий бэкап на VM (`bash deploy/synology/backup.sh` там же).

## Индексы на проде (М6, скорость С6)
На проде `autoIndex` выключен: новый `index: true` / `Schema.index()` сам не создаётся. Добавил индекс → после выкладки:
`docker cp backend/scripts/ensure-indexes.js datacore-backend:/app/scripts/` → `docker exec datacore-backend node scripts/ensure-indexes.js` (план) → `--apply`. Скрипт только создаёт недостающие (без удаления — индексы CRM на общих коллекциях не трогает); новую модель — дописать в `MODELS`.

## После деплоя (`release.sh` проверяет сам, сверь вывод)
`/api/health/ready` 200 → логин OK → `/admin` 200 → Mongo отклоняет неавторизованное чтение → kppdf `:3000` по-прежнему 200. Итог записать в `docs/HISTORY.md`.

Что делает каждый скрипт и шаг выкладки — `deploy/synology/README.md`. Пароль админа меняется в админке (Пользователи → Сброс пароля).
