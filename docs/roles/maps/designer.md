# Карта роли designer

коммит: 1cab104 + незакоммиченная ПВ (2026-10-25)

- Паспорт: форма backend/pwa/sections/passports/form.js (поля), wire-form.js:110–150 (готовность к выпуску, check), product-block.js (выбор изделия), стили ui/base.css классы pp-* около 303–312.
- Тексты: sections/passport-texts.js (дерево, панель ptext/ptextview), стили base.css pt-* около 901; меню справочников sections/dicts.js:59–66.
- Справочники паспортов: backend/src/modules/dicts/dicts.defs.ts:538–720 (passportPhrases плоский, категории строкой кодов).
- DESIGN: компоненты §4 строки 112–140; «Тексты паспортов» — строка 138 (устарела: упоминает флаг passports.v2).
- Аудит воронки: docs/roles/tz/PASSPORT-FUNNEL-designer.md.
- ПВ реализована (проверено по коду 25.10): ui/funnel.js (шаги, .pp-step/.pf-opt, base.css 1302–1339), ui/cat-chips.js, ui/quality.js, sections/passport-tree.js (дерево + панель ptnode), сводка — product-block.js:22–32, плашка — wire-form.js:130–140. DESIGN §4 строки 140–142 и §8 актуальны. Известно: кнопка «Сохранить» в пустой форме объяснена только title (product-block.js:22); фильтр «Дубли» в dicts.js исчезает при 0 дублей (застрять на qf=dupes).
