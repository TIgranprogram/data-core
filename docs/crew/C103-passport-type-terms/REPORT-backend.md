# C103 backend (пункты 6–8)
- 6 ✅ Тексты «категория паспорта» → «тип паспорта» в 33 файлах backend/src (справочники, ошибки, подсказки, DTO-описания); ключи не менялись. «Для каких категорий» → «Для каких типов паспорта»; справочник passportCategories назван «Типы паспортов».
- 7 ✅ Справочник passportTypes удалён (dicts.defs.ts, dicts.meta.ts); спеков на него не было; данные не тронуты. Остался backend/scripts/seed-passport-types.js (пишет в удалённый справочник) — решение координатора: удалить.
- 8 ✅ docs/MAP.md, docs/data-model.md обновлены.
- Проверки: tsc 0; jest 332/332 suites, 3428 tests. Спеки правлены: passport-order, passport-preview, dicts.product-groups.
- e2e не гонялся.
