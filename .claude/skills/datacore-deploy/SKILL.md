---
name: datacore-deploy
description: Безопасный деплой data-core на Synology/Ubuntu VM рядом с работающим прод-контуром kppdf. Использовать, когда пользователь просит задеплоить, обновить сервер, проверить VM или бэкапы на VM.
---

# Деплой на VM

Деплой — действие на внешнем сервере: **только по явной просьбе пользователя**, перед запуском одной строкой скажи, что будет сделано.

## Факты
- VM: Ubuntu на Synology, CPU без AVX → `mongo:4.4`. Хост/доступ — в gitignored `deploy/synology/CREDENTIALS.md` и `config.env` (читать можно, значения в чат и в коммиты не выносить).
- data-core: `/opt/data-core`, данные `/var/lib/datacore`, API `:3001`, контейнеры `datacore-*`, compose `docker-compose.prod.yml`.
- Рядом **прод kppdf** (`:3000`) — не трогать, не останавливать, не пересобирать.
- Бэкап: cron `/etc/cron.d/datacore` 03:00 → `deploy/synology/backup.sh`, лог `/var/log/datacore-backup.log`, ротация 14 дней.

## Запуск (Windows, из корня репо)
```powershell
.\deploy\synology\deploy.ps1            # preflight + deploy.py (нужен python + paramiko)
```
или напрямую `python deploy/synology/deploy.py` (`py` если `python` нет в PATH). Флаги: `--skip-build`.
**`--wipe` / `-Wipe` ЗАПРЕЩЁН** без явного письменного «да, стереть данные»: удаляет `/var/lib/datacore/mongodb/*`.

## Перед деплоем
1. typecheck + юнит зелёные (skill `datacore-verify`), изменения закоммичены.
2. Если меняется схема/данные — свежий бэкап на VM (`bash deploy/synology/backup.sh` там же).

## После деплоя (deploy.py проверяет сам, сверь вывод)
`/api/health/ready` 200 → логин OK → `/admin` 200 → Mongo отклоняет неавторизованное чтение → kppdf `:3000` по-прежнему 200. Итог записать в `docs/HISTORY.md`.

Документы `deploy/synology/*.md` (кроме этого скилла) устарели и описывают kppdf — см. `docs/TASKS.md` T7.
