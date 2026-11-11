# TEST-NOTES — разбор C058 (из TEST-LOG)

> Перенесено из docs/TEST-LOG.md (C069 / C068-D2). Журнал прогонов — docs/TEST-LOG.md.

## Разбор C058: почему office→home ломается на photos / ProxyCommand (2026-11-11)

**Контекст A7 (~02:00 МСК).** Дом→Sportin мостом прошёл (`direction=home->office`, finish done ~97 с, сайт 200). Обратный `office->home` упал на шаге `photos_pre` с «Не удалось передать фото». Сайт при этом оставался 200 (домен уже был на Sportin). Дом вернули **не** кнопкой, а вручную.

### Что рвётся в автоматической цепочке

1. **Направление асимметрично.** Home→office: Sportin доступен с VM **напрямую** по SSH (`HA_PEER_SSH=erpadmin@…`, без Proxy). Office→home: с Sportin до VM только через **VPS hop** — в `bridge.env` у office есть `HA_PEER_PORT=4222` и `HA_PEER_PROXY=ssh -i …/dc_hop … -W %h:%p root@VPS`.
2. **Мост собирает `RSH` для rsync** (`deploy/ha/switch/switch-watch.sh` ~80–86): опции SSH (в т.ч. `-i` ключ и `-o ProxyCommand=…`) кладутся в массив, затем склеиваются через `printf '%q'` в одну строку `RSH`, и rsync вызывается как `-e "$RSH"`.
3. **На `photos_pre` с office** в `/var/lib/datacore/switch/switch.log` (Sportin):
   - `Warning: Identity file \ not accessible`
   - `command-line line 0: no argument after keyword "\\"`
   - `rsync error: unexplained error (code 255)`
   То есть **ломается разбор аргументов внешнего `ssh`**: `-i` из ProxyCommand (внутренний hop) воспринимается как `-i` внешнего ssh, путь к ключу превращается в `\`. До передачи фото/данных дело не доходит — рвётся сам SSH-канал peer.
4. **Почему `peer()` ssh в preflight мог пройти, а rsync — нет.** Вызов `ssh "${PEER_OPTS[@]}"` передаёт ProxyCommand одним элементом массива. Вызов `rsync -e "$RSH"` снова прогоняет ту же строку через shell; вложенный `ProxyCommand=ssh -i …` при склейке/`%q` на office даёт поломанный argv. Home→office без Proxy эту ловушку не трогает.

### Что сработало вручную (авария)

1. С VM: `dc-switch home` на VPS → nginx `/db/` снова на порт **4201** (туннель Дома).
2. Mongo на обоих: `app_control_state` → Дом `role=main, mode=normal, job=null`; Sportin `role=standby, mode=normal`.
3. `docker start kppdf-backend` на Доме (CRM мост останавливал при switch).
4. Итог: `GET /api/control/switch` — `self=home`, `role=main`, `enabled=true`, SITE `/db/api/health/ready` = 200. **Фото/rsync при возврате не гонялись** — домен и роли выставили в обход шага photos.

### Что нужно для автоматического office→home

1. **Починить RSH+ProxyCommand** в `switch-watch.sh` (и/или `bridge.env` на office): чтобы `-e` для rsync не ломал вложенный `-i` hop. Надёжные варианты: отдельный `ssh` wrapper / `Include`/`-F` config-файл вместо склейки ProxyCommand в одну quoted-строку; либо тест `rsync -e …` в preflight на office до `photos_pre`.
2. Повторить A7: Дом→Sportin→Дом кнопкой, оба направления finish done, счётчики/health, без `dc-switch` руками.
3. Хвосты (не блокер разбора Proxy): выровнять `BACKUP_SECRET_KEY` (хеши), закрепить bind `:3001` только localhost на Sportin в репо, C045-6/8.

См. также `docs/crew/C058-two-servers-finish/REPORT.md`, логи `tools/logs/c058-a7-*.log`.
