# ТЗ: копии второго сервера (srv-erp) на NAS по SMB

Класс: L · агентов ≤ 3 · правило AGENTS.md №10: прод не меняется; всё для srv-erp — в `SRV-ERP/` и под переключателем `.env` `OFFSITE_SMB=1`.
Решение пользователя 2026-10-31: только SMB (WebDAV на NAS не ставить); бэкапы srv-erp отдельно от бэкапов дома; домашний прод — без изменений.

## Факты
- srv-erp: Ubuntu, 192.168.88.6, `/opt/data-core`, контейнеры `datacore-backend`, `datacore-mongo`; пользователь `erpadmin` в группе docker, sudo — с паролем (не использовать). Расписания бэкапов нет, `/var/lib/datacore/backups` пуст.
- NAS: Synology 192.168.88.2, скрытая общая папка `ERPBak` (только по полному пути). Логин и пароль вводит пользователь в админке.
- Копии вне дома: `backend/src/modules/disk/offsite.ts` (18 serverKey, 72 tick, 103 проверка https, 148–169), `offsite.controller.ts`, UI — `backend/admin/admin.js` (offsite).
- `SRV-ERP/refresh-copy.sh:66–68` — база srv-erp заменяется копией прода, цели выключаются.

## Решение (совет архитектора)
1. Отправка — одноразовый контейнер `docker run --rm --network host` с samba-client (образ из `SRV-ERP/smb/Dockerfile`: alpine + samba-client), `smbclient //192.168.88.2/ERPBak -m SMB3 -A /auth -c "…"`. Пароль только в authfile (600), не в командной строке.
2. Backend под `OFFSITE_SMB=1` (без флага — поведение прежнее, https-проверка как есть):
   - `saveTarget` принимает `kind:'smb'`, адрес `//host/share`, папка (по умолч. `srv-erp`), логин, пароль, keep (по умолч. 14).
   - пароль — шифрованно в backuptargets (как у WebDAV); при сохранении пишет authfile `username=…\npassword=…\ndomain=WORKGROUP` в `/var/lib/datacore/smb/auth.<id>` (том, права 600). Наружу пароль не отдаётся.
   - `tick` цели smb пропускает (их отправляет хост).
   - «Проверить» / «Отправить сейчас» для smb — ставят флаг `requestTest` / `requestRun`; хост пишет `lastResult`, `lastError`, `lastAt`.
   - ответ GET настроек отдаёт `smbEnabled: true` только при флаге; админка показывает «Тип: WebDAV / Сетевая папка (SMB)» только тогда.
   - юнит: без флага smb → 400, tick не трогает smb, authfile 600 и без пароля в логах.
3. Хост srv-erp (`SRV-ERP/`):
   - `backup-erp.sh` — ежедневно (cron erpadmin, 03:30): mongodump --archive --gzip через docker exec + tar uploads → `/var/lib/datacore/backups/srv-erp-YYYYMMDD-HHMM.tgz`; локально хранить 3. Образец — `deploy/synology/backup.sh` (сам файл не трогать). Шифрование — как у WebDAV-копий, если в offsite задан пароль шифрования (через `docker exec datacore-backend node …` той же функцией), иначе без.
   - `offsite-smb.sh` — отправка свежего бэкапа во все включённые цели `kind:'smb'` (читает из Mongo через docker exec), `mkdir` папки, `put`, ротация `keep` по имени; `--poll` (cron раз в минуту) — выполняет `requestTest` / `requestRun`, пишет результат в цель.
   - `install-smb.sh` — разово: сборка образа, каталоги `/var/lib/datacore/smb` (700), строки crontab без дублей, том для authfile в `docker-compose` srv-erp — через override-файл в SRV-ERP, не правя корневой compose.
   - `refresh-copy.sh`: до restore — `mongoexport` целей `{kind:'smb'}` и документа settings srv-erp; после — вернуть upsert'ом. Строку 68 оставить (WebDAV-цели прода выключаются). Явно задать `BACKUP_SECRET_KEY` в .env srv-erp (иначе после refresh не расшифровать пароль).
4. Подводные камни: имя шары без `$`, если скрыта флагом DSM; SMB3 включён на NAS; домен WORKGROUP; `--network host`; не `-U user%pass`.

## Роли
- backend (`backend/src/modules/disk`, `backend/admin` — только offsite) — п.2.
- исполнитель SRV-ERP (`SRV-ERP/` только) — п.3.
- проверка: architect по прод-безопасности (без флага ничего не меняется).

## Дополнение пользователя (2026-10-31): и домашний сервер
SMB-цель — общая возможность, не только srv-erp. Домашний прод может потом включить её у себя (`OFFSITE_SMB=1` в его .env + install-smb.sh), не меняя текущую архивацию (backup.sh, его cron, WebDAV-цели) — SMB-цель просто добавляется к ним. Поэтому:
- скрипты хоста — без зашитых srv-erp-путей: каталог бэкапов, префикс файлов (`srv-erp` / `home`), compose-проект — переменные с умолчанием; `offsite-smb.sh` умеет отправлять и последний бэкап `backup.sh` (`datacore-*.tgz`), не только `srv-erp-*`;
- `backup-erp.sh` нужен только там, где нет своего бэкапа (srv-erp); на доме бэкап уже делает backup.sh.
- сейчас на доме ничего не включать.


## Решение пользователя 2026-10-31 (поздно): сервера одинаковые
Включатель OFFSITE_SMB убран (SMB есть везде; `OFFSITE_SMB=0` — выключить явно). Скрипты — `deploy/smb/`. Каталог файлов доступа монтирует `docker-compose.prod.yml`. Установлена ли отправка — отметка хоста `settings.smbAgentAt`, админка подсказывает. Кнопки пульта: «Копии на NAS: установить на Sportin / на домашнем сервере».
