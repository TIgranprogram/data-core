# Карта роли architect

коммит: 61b18c6

Паспорта: текст сейчас — product-passport/passport-v2-text.ts:buildV2Text (Для всех = код + ALL_V2 в passporttemplates, плюс версия категории; замена по номеру пункта); снимок service.snapshot (~284) в textSnapshot; выпуск passport-issue.ts:32.
Справочники паспортов — dicts/dicts.defs.ts:538–720 (simpleList, ppUsage, withProducts для merge/reassign); dict_values индекс dict+deletedAt (ensure-indexes.js:20).
Изделие в паспорт: products.passportDefaults (showcase/passport-defaults.ts, PUT :id/passport-defaults, bulk в showcase-bulk.ts); клона изделия в showcase нет.
Решение ПВ (воронка): docs/roles/tz/PASSPORT-FUNNEL-architect.md.
Ловушки: DTO паспорта (forbidNonWhitelisted); GET passports/phrases старый, дублирует справочник.
