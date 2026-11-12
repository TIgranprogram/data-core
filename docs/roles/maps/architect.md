# Карта роли architect

коммит: 8d4b21dc (12.11.2026: узкий review C089 UI незакоммиченного diff + C091 пульт; общий хвост architect не закрыт)
C086: прежние 3 находки закрыты: compose.ts:138 → gaps.ts:175 сохраняют применимость заполненных чисел; gaps.ts:103,106 проверяет сохранённое назначение; order.ts:96,98 — два пакета групп (ещё нужен deletedAt:null). PDF отдельного прохода не проверен. Отчёт: docs/crew/C086-passports-owner-review/ARCH-REVIEW.md.
C022 волна B (2026-11-04): открытие «Склада» несколько раз бьёт GET /stock/items?limit=10000 и /stock/categories; 325 с в SlowScreen — таймер плиток, не один запрос. Кэш клиента гасит data-changed (stock-list.js:41, stock.js:24, :98). Серверный stock.items сбрасывает запись CRM в materials/storageitems/supplyrequests/categories/warehouses. Отчёт: docs/crew/C022-stock-order/ARCHITECT.md.
аудит C013: без коммита кода, HEAD на чтении 23ff7ff7 (2026-11-03).

Паспорта: текст сейчас — product-passport/passport-v2-text.ts:buildV2Text (Для всех = код + ALL_V2 в passporttemplates, плюс версия категории; замена по номеру пункта); снимок service.snapshot (~284) в textSnapshot; выпуск passport-issue.ts:32.
Справочники паспортов — dicts/dicts.defs.ts:538–720 (simpleList, ppUsage, withProducts для merge/reassign); dict_values индекс dict+deletedAt (ensure-indexes.js:20).
Изделие в паспорт: products.passportDefaults (showcase/passport-defaults.ts, PUT :id/passport-defaults, bulk в showcase-bulk.ts); клона изделия в showcase нет.
Решение ПВ (воронка): docs/roles/tz/PASSPORT-FUNNEL-architect.md.
Ловушки: DTO паспорта (forbidNonWhitelisted); GET passports/phrases старый, дублирует справочник.
Аудит покупателя 2026-10-30 (сервер и данные). Узлы риска: оплата — incomes.service.ts:198 (paidDate в PATCH стирает payments), :214 (перезапись массива); счёт — supply-invoice.service.ts:345 (received → ordered); отмена склада — stock-movements.service.ts:220, :436; clientUid проверяется вне транзакции (:43, :138); брони — stock-reservations.service.ts:121; листы — sheets-sync.targets.ts:130, :202 (adopt без editedInApp); бэкап — backup.sh:44, :48, :67; выкладка — release.sh:53, :56.
C013 (2026-11-03): два сервера — суточный refresh-copy, не replica set. Задача Windows «DataCore copy refresh» на этом ПК есть (1–2.11 ок; 3.11 tar код 2, архив datacore-2026-11-03_030001.tgz). Кнопка SW-1…6 в коде; HA_SELF и setup-switch на проде не включались; SW-7 нет; автодомен при смерти не написан. Макет: потеря ~30 % при обрыве канала и смерти главного — автомат нельзя. Отчёт: docs/crew/C013-ha-sportin/.
C042 (2026-11-07): кнопка переключения в коде есть, но HA_SELF и cron-мост не включены (setup-switch.sh --enable не запускали, BACKLOG:25); refresh Sportin раз в сутки с домашнего ПК, падал 3.11 и 6.11 (refresh.log:38,64-70); боем не гоняли. Отчёт: docs/crew/C042-server-switch/AUDIT.md, PLAN.md.

C089/C091: fill/index.js:31 + paint.js:187 — related main/side без изменения save/API; kit.css:761 — общие drawer требуют визуальной приёмки. pult/ui/app.js:171 — безусловный renderTester после await может подменить другой раздел; tester.mjs:27 — state без содержимого marker/REPORT. Отчёт: docs/crew/C089-workplace-clarity/ARCH-REVIEW.md. Карта обновлена.
