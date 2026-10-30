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
5. `build backend` (кроме `--skip-build`; старый backend работает) → `up -d` — пересоздаются только изменившиеся контейнеры. **Без `down`**: `datacore-mongo` обслуживает и kppdf, остановка базы уронила бы CRM.
6. Проверки: rs0 `ok` → `GET :3001/api/health/ready` (до 120 с; иначе печатает логи и `FAIL`) → `POST /api/auth/login` admin → `/admin/` 200 → Mongo без пароля отклоняет чтение.

Флаги: `--skip-build`, `--platform ubuntu|synology` (synology: `/volume1/docker/...`), `--host/--user/--password` (перекрывают `config.env`). `DEPLOY_SSH_KEY` из переменной окружения важнее `config.env`.

## ⚠️ `--wipe` / `-Wipe` / `WIPE=true`

**С 2026-10-18 заблокирован в `deploy.py`:** база общая с CRM kppdf, wipe сотрёт и его данные. Снять блок можно только `FORCE_WIPE_UNIFIED=yes` — по письменному решению пользователя и после бэкапа.

Только по явному письменному «да, стереть данные» пользователя. Делает: `compose down`, `docker rm -f datacore-backend datacore-mongo`, **`rm -rf REMOTE_DIR/*`, `DATA_DIR/mongodb/*` и `DATA_DIR/uploads/*`** (бэкапы в `DATA_DIR/backups` остаются). kppdf не трогает. Включается и строкой `WIPE=true` в `config.env` — проверь, что её там нет.

## Порядок

1. Локально: typecheck + юнит зелёные (skill `datacore-verify`), всё закоммичено.
2. Если меняются схема/данные — свежий бэкап на VM: `cd /opt/data-core && bash deploy/synology/backup.sh`.
3. `.\deploy\synology\deploy.ps1` (или `python deploy/synology/deploy.py`).
4. Сверить вывод шага 6; убедиться, что kppdf `:3000` отвечает 200. Записать итог в `docs/HISTORY.md`.

## Бэкапы на VM

- Копия вне NAS: ежедневно на Windows-ПК в `D:\datacore-backups` — `deploy/backup-pull/README.md`.
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

## Выкладка с работы (вне домашней сети, с 2026-10-21)

```
рабочий ПК → ssh kppdf-crm.ru:22 (ProxyJump) → VPS 127.0.0.1:4222 → туннель → VM 127.0.0.1:22 → release.sh
```
- Ключ «рабочий ПК» (комментарий `datacore-work-pc`) — в gitignored `remote-access/secret/`; инструкция и скрипты — `remote-access/README.md`. Выкладка: `bash remote-access/deploy.sh` (= `VM=datacore-vm KEY=~/.ssh/datacore_work release.sh`).
- VPS: строка в `/root/.ssh/authorized_keys` с `restrict,port-forwarding,permitopen="127.0.0.1:4222",command="/bin/false"` — консоли нет, только проход к 4222 (проверено: shell и другие порты отклоняются). sshd/nginx не менялись. Бэкап: `authorized_keys.bak-datacore-work-20261021`.
- VM: ключ в `~tiit/.ssh/authorized_keys` с `from="127.0.0.1,::1"` (из локальной сети не пускает); туннель — строка `datacore-ssh-tunnel` в crontab tiit (`autossh -R 127.0.0.1:4222:127.0.0.1:22`, flock `/tmp/datacore-ssh-tunnel.lock`). Проверка: `pgrep -af "autossh.*4222"`. Бэкапы: `~/.ssh/authorized_keys.bak-datacore-work-20261021`, `~/crontab.bak-datacore-work-20261021`.
- Порт 4222 на VPS из-за `GatewayPorts yes` слушает `0.0.0.0`, но снаружи закрыт ufw (открыты только 22/80/443). Не открывать.
- **Отзыв:** `sed -i "/datacore-work-pc/d" ~/.ssh/authorized_keys` на VM и у root на VPS; туннель — убрать строку из crontab и `pkill -f "autossh.*4222"`.

## Место на диске (с 2026-10-21, TASKS ДИ)

- Админка → «Сервер»: занято / всего / свободно, полоса (>80% жёлтая, >90% красная), сколько занимают база, фото, бэкапы, прогноз «на сколько хватит» (по снимкам за 30 дней). API — `GET /api/health/disk` (админ / директор).
- Для этого backend видит `DATA_DIR` только для чтения (`/host-data` в `docker-compose.prod.yml`).
- `release.sh` печатает `df -h /var/lib/datacore` до и после выкладки и **останавливается, если свободно < 2 ГБ**; `remote-access/check.sh` — строка «4. Место на диске сервера».
- Освободить место: старые папки `/var/lib/datacore/backups/*` (ротация 14 дней), `backend.prev-*` в `/opt/data-core`, `docker image prune` — только осознанно.

## Копии вне дома (БКП, с 2026-10-27)
Настройка — админка → «Сервер» → «Копии вне дома»: места WebDAV (Яндекс-Диск `https://webdav.yandex.ru` + пароль приложения, Nextcloud, второй Synology), время, сколько хранить, пароль шифрования. Код — `backend/src/modules/disk/offsite.ts`.
Файл в облаке: `datacore-<штамп>.dcb` — zip (`mongo-<штамп>/` + `uploads-<штамп>/`), зашифрованный AES-256-GCM паролем пользователя.

**Восстановить из копии вне дома (сервер погиб, ИИ рядом нет):**
1. Скачать `.dcb` с Яндекс-Диска (папка `datacore-backups`) на любой ПК с Node.js 18+.
2. Расшифровать: `node backend/scripts/backup-decrypt.js datacore-<штамп>.dcb` → спросит пароль шифрования → рядом появится `.zip`. Неверный пароль — «Неверный пароль или файл повреждён».
3. Поднять сервер с кодом: Ubuntu + Docker, `git clone` репо, `docker compose -f docker-compose.prod.yml up -d` (секреты `.env` — из `CREDENTIALS.md` у владельца; новый пароль Mongo — тоже можно).
4. Распаковать zip; базу — `docker cp mongo-<штамп> datacore-mongo:/tmp/` и `mongorestore -u <root> -p <пароль> --authenticationDatabase admin --db datacore /tmp/mongo-<штамп>/datacore` (без сжатия, как пишет `backup.sh`; в пустую базу, **без `--drop`**); фото — скопировать `uploads-<штамп>/` в `${DATA_DIR}/uploads/`.
5. Проверить: `/api/health/ready` = 200, вход в приложение, число заказов и паспортов. Учебный прогон копии — `bash deploy/synology/restore-drill.sh` раз в месяц (итог в `backups/drill.log`). Откат выкладки — `bash deploy/synology/rollback.sh` на VM.
6. Туннель и nginx на VPS — раздел «Публичный доступ» выше.
Пароли целей и шифрования в базе зашифрованы ключом `BACKUP_SECRET_KEY` (нет — `JWT_SECRET`): сменили ключ — заново впишите пароли в админке.

## Диагностика на VM

```bash
cd /opt/data-core
sudo docker compose -f docker-compose.prod.yml ps
sudo docker compose -f docker-compose.prod.yml logs --tail 100 backend
curl -sf http://localhost:3001/api/health/ready
```
Правка `.env` на VM вручную перезапишется следующим деплоем — меняй `config.env` локально. Применить без пересборки: `deploy.py --skip-build`.

## Переносной пакет (БЗ-13, шаг 1: скрипты)

Всё приложение одним архивом — чтобы пережить потерю VM и переехать на новую. **В пакете секреты** (`.env`, пароли Mongo): права 600, не класть в репозиторий, не пересылать открыто.

| Файл | Где | Что делает |
|--|--|--|
| `bundle.sh` | на VM | Собирает `datacore-bundle-<дата>.tar.gz`: код data-core и kppdf, `mongodump --archive --gzip` всей `datacore` (внутри `datacore-mongo`, пароль root из `.env` как в `backup.sh`, передаётся через окружение контейнера), `uploads/` обоих, конфиги (compose, `.env`, nginx, crontab, systemd), `MIGRATE.md`, `manifest.json` (дата, коммиты, число документов по коллекциям, sha256 файлов). Рядом `.sha256`. Ничего не останавливает, в базу только читает. |
| `bundle-pc.sh` / `bundle.cmd` | ПК (Git Bash) | Меню: 1) собрать на VM и скачать в `C:\datacore-bundles\<дата>.tar.gz` (докачка при обрыве, сверка sha256); 2) проверить пакет (распаковка + сверка manifest); 3) напечатать шаги переезда из `MIGRATE.md` (автоматического восстановления нет). |

- Запуск на VM: `cd /opt/data-core && bash deploy/synology/bundle.sh`. Куда: `BUNDLE_DIR` (по умолчанию смонтированная общая папка Synology, иначе `/opt/datacore-bundles`); хранится последних `BUNDLE_KEEP` (3). Пути меняются через `DC_DIR`, `KPPDF_DIR`, `DATA_DIR`, `KPPDF_UPLOADS`.
- Запуск с ПК: `deploy\synology\bundle.cmd` (или `bash deploy/synology/bundle-pc.sh`; без меню: `build`, `verify [файл]`, `steps [файл]`). Вход на VM — как в `release.sh`: `VM`, `KEY` (с работы `VM=datacore-vm`).
- Проверка: пункт 2 меню — «ПАКЕТ В ПОРЯДКЕ» = архив читается, все sha256 по `manifest.json` совпали, дамп не пустой. Проверка восстановимости — restore-дрилл во временную базу (см. «Бэкапы на VM»); `mongorestore --drop` скрипты не используют.
- Ограничения: nginx живёт на VPS — копия попадает в пакет, только если файл читается с VM (блок `/db/` лежит в коде всегда); образы Docker не включены (собираются из кода).
### Кнопка «Собрать пакет» в админке (Сервер → Переезд на другой сервер)

Контейнер не может запустить `bundle.sh` сам, поэтому связка через файлы: админка (только роль admin) кладёт `${DATA_DIR}/bundle-requests/request`, `bundle-watch.sh` на хосте подхватывает его, запускает `bundle.sh` (`BUNDLE_DIR=${DATA_DIR}/bundles`, хранится `BUNDLE_KEEP`=2) и пишет `bundle-requests/status.json` (running / done / failed). Лог без секретов — `${DATA_DIR}/bundles/bundle.log`. Скачивание — из админки (папка `bundles` смонтирована в контейнер `:ro` как `/host-bundles`).

Поставить (один раз, **до** выкладки compose с новыми томами — иначе Docker создаст папки от root):
```bash
cd /opt/data-core && DATA_DIR=/var/lib/datacore bash deploy/synology/bundle-watch.sh   # создаст папки (запроса нет — сразу выйдет)
crontab -e   # пользователь tiit, добавить строку:
* * * * * DATA_DIR=/var/lib/datacore bash /opt/data-core/deploy/synology/bundle-watch.sh >/dev/null 2>&1
```
Проверить: `touch /var/lib/datacore/bundle-requests/request` → в течение минуты `cat /var/lib/datacore/bundle-requests/status.json` покажет `running`, затем `done` с именем файла; при `failed` — `tail /var/lib/datacore/bundles/bundle.log`. Повторный запуск при идущей сборке безопасен (flock). Если сборка «зависла» после перезагрузки хоста — через 6 часов админка сама покажет ошибку; запрос можно повторить.


## Инцидент 2026-10-24: сайт 504 после смены внешнего адреса дома
После переподключения роутера на VPS остались висеть старые туннели (порты 4200/4201/4222 заняты), новые не поднимались: «remote port forwarding failed». Решение: на VPS `fuser -k` портов + `/etc/ssh/sshd_config.d/alive.conf` (`ClientAliveInterval 15`, `ClientAliveCountMax 3`) — мёртвые туннели теперь сбрасываются за ~45 с сами. У пользователя `tiit` на VM нет sudo — службу `kppdf-tunnel` перезапускает только root; autossh после многих неудач ждёт до 10 мин.
