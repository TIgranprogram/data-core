# C042-A — аудит: переключение и синхронизация двух серверов (2026-11-07, только чтение, на серверы не заходил)

Источники: код backend/src/modules/control/switch/*, backend/admin/control-switch.js, deploy/ha/switch/*, SRV-ERP/*, D:\datacore-backups\refresh.log, tools/logs/setup-switch-20261103.log, docs/BACKLOG.md:25, карта architect (C013). Живые .env серверов не видел (запрещено) — помечено «по следам».

## Схема сейчас (текстом)
Пользователь -> kppdf-crm.ru/db/ -> VPS nginx (upstream datacore_db, сейчас :4201 = туннель к домашней VM) -> VM :3001 (главный; рядом CRM kppdf на той же базе).
Sportin (srv-erp, 192.168.88.6) — отдельный сервер со своей Mongo. Данные туда попадают РАЗ В СУТКИ: задача Windows «DataCore copy refresh» в 11:00 на домашнем ПК берёт последний tgz из D:\datacore-backups (его в 10:00 тянет «backup pull» с VM) -> scp на Sportin -> mongorestore --drop + фото «только новые» (refresh-copy.sh). Реплики нет. Sportin открыт прямым IP :8080, на VPS рабочим не подключён (туннель :4203 поднят, домен ведёт на :4201).

## Таблица звеньев
| Звено | Статус | Где / как видно |
|--|--|--|
| Код кнопки: роль, режим чтения 503, журнал, защита от двойного нажатия, обратный ход, «Обновить» | есть (юнит-тесты) | switch.service.ts, switch.rules.ts, switch.middleware.ts:26, app.module.ts:287 |
| Вкладка «Серверы» в админке | есть, но кнопка не работает: без HA_SELF маршруты кроме обзора дают 404, enabled:false | index.html:46,300; control-switch.js; switch.controller.ts:9 |
| HA_SELF=home на VM и office на Sportin | НЕТ (по следам): BACKLOG:25 пункт 0а открыт, карта C013 «HA_SELF не включались»; шаг --enable в setup-switch.sh (блок 6) не запускали | главная причина «кнопки до сих пор нет» |
| Мост switch-watch.sh в cron (раз в минуту, оба сервера) | НЕТ: ставится только --enable | setup-switch.sh блок 6; canStart требует bridgeAlive (switch.rules.ts:141) |
| Переключатель на VPS dc-switch, ключи, блок /db/ nginx | есть, проверено 3.11 | лог setup-switch: domain=home port=4201, home=up, office=up; VM<->Sportin ok |
| Туннель Sportin -> VPS :4203 | есть (office=up) | setup-tunnel.sh |
| bridge.env с ключами на обоих | есть по логу 3.11 | setup-switch.sh блок 5 |
| Свежесть копии | СЛОМАНО: refresh 3.11 — tar warning (код 2), 6.11 — Unexpected EOF (бэкап скачан обрезанным), 5.11 прогона нет; 4.11 и 7.11 ок. Зависит от включённого домашнего ПК | refresh.log:38-39, 64-70 |
| Блокер «Копия старше суток» | любой пропуск блокирует кнопку (canStart) | switch.rules.ts:139-140 |
| Сам переключатель при живом главном: дамп -> Sportin -> сверка -> dc-switch | написан, НИ РАЗУ не гонялся боем (SW-7 нет; BACKLOG:25 «ssh, rsync, nginx не проверялись») | switch-watch.sh шапка |
| Обновление копии по таймеру без ПК | НЕТ: «Обновить» есть кнопкой (kind=refresh), по расписанию не вызывается | switch-watch.sh шапка |
| Репликация (replica set) | НЕТ (HA-6…14 не начаты); макет: потеря 30 % записей при обрыве канала + смерти главного | deploy/ha/lab/results; TZ HA-TWO-SERVERS «Итог макета» |
| Автопереключение при смерти главного | НЕТ и по макету запрещено без защиты по лагу; есть аварийная кнопка canEmergency на Sportin (данные на последний бэкап) | switch.rules.ts |
| Фото uploads | rsync --ignore-existing при переключении/обновлении, без --delete | switch-watch.sh; refresh-copy.sh:77 |
| Код на Sportin = код VM | только вручную refresh-copy.sh --code или «Обновить»; release.sh второй сервер не обновляет; HA_PEER_URL ставится лишь с --code | refresh-copy.sh:59 |
| CRM kppdf | ЧАСТИЧНО: на Sportin CRM нет; на VM пишет мимо режима чтения; мост лишь предупреждает | switch-watch.sh:271,346; QUESTIONS.md:34 |
| Защита от двух главных (fencing) | частично: роль в app_control_state, вернувшийся старый главный сам уходит в standby, если домен у соседа; middleware режет запись в readonly. Дыры: CRM и прямой IP :8080 Sportin | switch-watch.sh шапка |
| Бэкап и SMB на Sportin | есть | SRV-ERP/README.md, backup-erp.sh |

## Что мешает кнопке (по убыванию)
1. Не выполнен setup-switch.sh --enable + перезапуск backend на обоих серверах (ждёт решения про CRM).
2. Копия на Sportin легко старше суток (сбой ПК / обрезанный бэкап) -> блокер canStart.
3. Боевой прогон ни разу не делали: ошибки ssh/rsync/nginx неизвестны.
4. Не проверено (секреты не читал): JWT_SECRET и BACKUP_SECRET_KEY должны совпадать на обоих, иначе после переключения все выйдут из системы, а шифрованные пароли целей копий не расшифруются.

## Риски
- Два пишущих: покрыто ролью и readonly; дыры — CRM и прямой :8080.
- Потеря между обновлением и переключением: при живом главном нулевая (свежий дамп под readonly до 10 мин); при аварии — до суток.
- Версии кода: ступенчатой выкладки нет, схема Mongo общая -> разные версии на двух серверах опасны.
