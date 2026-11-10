# C058 — PLAN (по DIAG 2026-11-10)

Разрешение пользователя: все записи Дом/Sportin/VPS в рамках C058; **записи на серверы не раньше 00:30 МСК** (до этого выкладка Claude); A7 сегодня в **02:00** МСК; если после переключения сайт мёртв — сразу вернуть на Дом; CRM не трогать кроме остановки мостом; секреты не читать; базы не удалять.

**2026-11-10 23:54:** прерван ранний `refresh-copy --code` (шёл scp, restore не начат); incoming на Sportin снят.

## Порядок

| # | Шаг | Запись | Бэкап до | Проверка после |
|--|--|--|--|--|
| 1 | Свежий бэкап Дома → ПК | Дом read+дамп | — | tgz `gzip -t`, размер |
| 2 | `refresh-copy.sh --code` | Sportin код+база+фото | before-refresh на Sportin (скрипт) | health 200, version ≈ Дом, last-refresh свежий |
| 3 | `setup-switch.sh --enable` | HA_SELF + cron моста оба | копия `.env` строк HA_* на обоих (без значений в лог) | crontab has switch-watch |
| 4 | Перезапуск backend оба | docker restart | — | `GET /api/control/switch` → enabled:true, bridge.alive |
| 5 | A4: хеши JWT/BACKUP | нет (только sha256) | — | хеши равны |
| 6 | A4: закрыть WAN :8080 | Sportin firewall / bind | правило с комментарием C058 | с ПК: public :8080 отказ; localhost:3001 и туннель ок; **HA_PEER_URL** Дома должен остаться рабочим (если URL = :8080 — сначала сменить на путь через VPS/LAN или не рвать peer) |
| 7 | Авто refresh | сам главный | — | два last-refresh с Δ≈15 мин или job refresh |
| 8 | C045-6/8 | код при необходимости | — | dc check |
| 9 | A7 в 02:00 | Дом→Sportin→Дом | свежий бэкап Дома | счётчики, health, домен, TEST-LOG |
| 10 | Доки | SERVERS-STATUS, CONTROL, BOARD, REPORT | — | коммит |

## Откат

- Enable: убрать `HA_SELF` из `.env`, убрать cron switch-watch, restart backend.
- :8080: снять iptables/ufw правило C058.
- A7: кнопка обратно / fail до vps сам откатывает.
- Код Sportin: повторный refresh из tgz / before-refresh.

## Не делать

dropDatabase, deleteMany томов, чтение секретов, правки kppdf кроме stop мостом.
