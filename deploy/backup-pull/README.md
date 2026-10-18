# backup-pull — копия бэкапов вне NAS (на Windows-ПК)

Уровни бэкапа:
1. **VM (NAS):** cron 03:00 → `deploy/synology/backup.sh` → `/var/lib/datacore/backups/{mongo,uploads}-<дата>`, 14 дней.
2. **Этот ПК:** задача Windows «DataCore backup pull» (ежедневно 10:00; пропущенный запуск — при включении ПК) → `pull-backup.ps1` забирает **последний** бэкап с VM в `D:\datacore-backups\datacore-<дата>.tgz`, хранит 30 дней. Лог — `D:\datacore-backups\pull.log`.

| Файл | Что |
|--|--|
| `pull-backup.ps1` | Выгрузка последнего бэкапа (SSH-доступ к VM — из gitignored `deploy/synology/config.env`). Запуск вручную: `powershell -File deploy\backup-pull\pull-backup.ps1` |
| `register-task.ps1` | Создать/обновить задачу в Планировщике (повторный запуск безопасен) |

`D:\` обычно переживает переустановку Windows (стирается `C:`). Для полной надёжности раз в месяц копируйте свежий `.tgz` на флешку или в облако — файл маленький.

## Восстановление из архива (только с «да» пользователя)

```bash
# на VM: распаковать и восстановить в ТЕСТОВУЮ БД, сверить, потом решать
scp datacore-<дата>.tgz <user>@<vm>:/tmp/ && ssh <user>@<vm>
mkdir /tmp/r && tar -xzf /tmp/datacore-<дата>.tgz -C /tmp/r
docker cp /tmp/r/mongo-<дата> datacore-mongo:/tmp/restore
docker exec datacore-mongo sh -c 'mongorestore -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --nsFrom "datacore.*" --nsTo "datacore_restore_test.*" /tmp/restore'
```
Сверка — `deploy/synology/verify-restore.js`. Восстановление в живую `datacore` (`--drop`) и копирование `uploads-<дата>` в `/var/lib/datacore/uploads` — только по явному решению.
