# C058 REPORT — два сервера (2026-11-11)

## Что было сломано → доказательство → правка

| Причина | Доказательство | Правка |
|--|--|--|
| A1 не включён: нет HA_SELF / cron моста | DIAG: enabled:false, HA_SELF absent, switch/ пуст | `setup-switch.sh --enable`; compose up; bridge.env + chmod 1777 на Доме |
| Авто 15 мин молчал | следствие A1 | после enable autoRefresh minutes=15; lastAt зафиксирован; ручной refresh done, copyAgeMin=0 |
| Нет rsync на Доме | refresh failed «нет rsync» | `$HOME/bin/rsync` (+ libs); cron PATH; правки switch-watch PATH/--rsync-path |
| `--rsync-path="$HOME/..."` раскрывал HOME локально | лог: remote `/home/tiit/bin/rsync` missing | одинарные кавычки `'$HOME/bin/rsync'` |
| Прямой :8080 | curl public 200 | bind `127.0.0.1:3001` + iptables DOCKER-USER C058-A4 → public 000 |
| HA_PEER_URL был :8080 | len/mask http://x.x.x.x:8080 | → `http://VPS:4203` (туннель) |

## A7 (02:00)

1. В момент старта шёл авто-refresh → первый `start` дал 409; скрипт ошибочно принял конец refresh за переключение.
2. Следующий `start` выполнил **home→office** (~97 с), finish done, сайт 200, self=office/main.
3. Обратный office→home через мост **упал на photos_pre** (ProxyCommand/Identity file `\` — кавычки RSH+Proxy).
4. Аварийно: `dc-switch home` + роли Mongo (Дом main, Sportin standby) + `docker start kppdf-backend`. Итог: **Дом main**, SITE=200, CRM healthy.

**Честно:** полный round-trip кнопкой office→home через photos **не зелёный**; возврат домена/ролей — аварийный. home→office через мост — зелёный.

## Проверено

- enabled:true оба; bridge alive; версии `v1.685 · d9403c7e` совпали после refresh
- JWT_HASH_MATCH; BAK_HASH_DIFF (на Доме BACKUP_SECRET_KEY пуст — sha256 пустой строки)
- PUBLIC_8080=000; localhost Sportin 200; сайт /db/ 200
- Авто refresh: lastAt + успешный job refresh (данные+код шаг)

## Осталось

- Починить RSH/ProxyCommand Sportin→VM (office→home photos) — воспроизводимый баг кавычек
- BAK_SECRET выровнять хешами (без чтения в чат) или завести ключ на Доме
- C045-6 тревога «копия старше N»; C045-8 список коллекций из реестра
- Патч compose ports на Sportin перезапишется следующим `--code` — закрепить `BACKEND_BIND` в репо или override
- apt install rsync на Доме (passwordless sudo) вместо ~/bin

## Коммит/доки

Правки `deploy/ha/switch/switch-watch.sh` (PATH/rsync) + DIAG/PLAN/REPORT/scripts.
