# Карта роли architect

коммит: 5157e5e

Паспорта: текст сейчас — product-passport/passport-v2-text.ts:buildV2Text (Для всех = код + ALL_V2 в passporttemplates, плюс версия категории; замена по номеру пункта); снимок service.snapshot (~284) в textSnapshot; выпуск passport-issue.ts:32.
Справочники паспортов — dicts/dicts.defs.ts:538–720 (simpleList, ppUsage, withProducts для merge/reassign); dict_values индекс dict+deletedAt (ensure-indexes.js:20).
Изделие в паспорт: products.passportDefaults (showcase/passport-defaults.ts, PUT :id/passport-defaults, bulk в showcase-bulk.ts); клона изделия в showcase нет.
Решение ПВ (воронка): docs/roles/tz/PASSPORT-FUNNEL-architect.md.
Ловушки: DTO паспорта (forbidNonWhitelisted); GET passports/phrases старый, дублирует справочник.
Аудит покупателя 2026-10-30 (сервер и данные). Узлы риска: оплата — incomes.service.ts:198 (paidDate в PATCH стирает payments), :214 (перезапись массива); счёт — supply-invoice.service.ts:345 (received → ordered); отмена склада — stock-movements.service.ts:220, :436; clientUid проверяется вне транзакции (:43, :138); брони — stock-reservations.service.ts:121; листы — sheets-sync.targets.ts:130, :202 (adopt без editedInApp); бэкап — backup.sh:44, :48, :67; выкладка — release.sh:53, :56.
