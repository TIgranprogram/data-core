# Два сервера: статус (2026-11-11, после C058)

Названия в пульте: «Дом (Synology) — рабочий сайт» и «Sportin (Windows) — второй сервер».

| Пункт | Что есть | Работает ли | Чего нет / что делать |
|--|--|--|--|
| Переключатель A1 | HA_SELF=home/office, cron switch-watch, bridge alive | **да** — enabled:true, canStart/canRefresh | — |
| Авто refresh 15 мин | backend autoRefresh + мост | **да** — lastAt есть; ручной refresh finish done | office→home photos через Proxy ломается |
| Обновление с кодом | refresh-copy.sh --code | проверено 2026-11-11 | — |
| :8080 снаружи | закрыт (bind 127.0.0.1 + iptables C058-A4) | **да** public 000 | патч compose на Sportin не в git — не затирать `--code` без BIND |
| VPS dc-switch / туннель :4203 | на месте | **да** | — |
| A7 учебное | home→office мостом ок (~97с); office→home photos fail → аварийный возврат dc-switch | частично | починить ProxyCommand RSH |
| Секреты | JWT хеши равны | BACKUP_SECRET_KEY на Доме пуст (хеш ≠ Sportin) | выровнять |

Порядок дальше: починить office→home rsync/Proxy → повторить A7 туда-обратно → C045-6/8.
