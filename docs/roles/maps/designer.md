# Карта роли designer

коммит: b0b3298 + вкладка «Серверы» (control-switch.js/css, admin.js:338), полоса write-retry (main.js:263–270, api.js)
- Каталог поставщиков + крошки + вкладки счетов (аудит 28.10): ТЗ docs/roles/tz/SUPPLIER-CATALOG-UX.md; supplier-catalog.js:55–95,220–240, requests-tabs.js:16–20, invoices-tab.js:93, screens.css:1236–1239,1304–1310, main.js:90–96,188–193.

- Паспорт: форма backend/pwa/sections/passports/form.js (поля), wire-form.js:110–150 (готовность к выпуску, check), product-block.js (выбор изделия), стили ui/base.css классы pp-* около 303–312.
- Тексты: sections/passport-texts.js (дерево, панель ptext/ptextview), стили base.css pt-* около 901; меню справочников sections/dicts.js:59–66.
- Справочники паспортов: backend/src/modules/dicts/dicts.defs.ts:538–720 (passportPhrases плоский, категории строкой кодов).
- DESIGN: компоненты §4 строки 112–140; «Тексты паспортов» — строка 138 (устарела: упоминает флаг passports.v2).
- Аудит воронки: docs/roles/tz/PASSPORT-FUNNEL-designer.md.
- ПВ реализована (проверено по коду 25.10): ui/funnel.js (шаги, .pp-step/.pf-opt, base.css 1302–1339), ui/cat-chips.js, ui/quality.js, sections/passport-tree.js (дерево + панель ptnode), сводка — product-block.js:22–32, плашка — wire-form.js:130–140. DESIGN §4 строки 140–142 и §8 актуальны. Известно: кнопка «Сохранить» в пустой форме объяснена только title (product-block.js:22); фильтр «Дубли» в dicts.js исчезает при 0 дублей (застрять на qf=dupes).
- Проектирование (ПРЖ-5, проверено по коду 25.10): sections/design.js (доска/форма/карточка), ui/board.js, sections/order-design.js (блок в заказе), стили base.css 1329–1345 (+ .board/.tcard 126–139, 522–543). DESIGN §4 стр.146–147, §8 стр.264. Находки: #fff в .t-pic (1331), 12px (1333), avatar без aria-label (design.js:40), пустая доска — 4×«Пусто» без подсказки, emptyText на доске не показывается.
- Продукция-витрина (аудит 27.10): sections/products.js 160–240, ui/list.js 67/372/453, screens.css 704–738, form.css 133–145; баг «Таблица» — router.go:37 + list.js:67; ТЗ docs/roles/tz/PRODUCTS-UI.md.
- Аудит UI 2026-10-29: docs/audit/AUDIT-UI.md. Панель: card.js:60,63–66,121,135–144 (два «⋯»), prefs.js:15–21,124–132 (STR/setPref), screens.css:18,33, list.css:70–76, form.css:33; шапки списков requests.js:254, products.js:308, stock.js:58–72; окна ввода orders.js:77/102/128, payroll.js:52, money.js:79, partners.js:206, supplier-catalog.js:213; крошки crumbs.js + main.js:106,343.
- Сопоставление с картинками (приёмка 31.10): matching-queue.js:64–83, salesorders-matching.js:35–40,52, screens.css:1521–1525. `.pic.empty` (screens.css:189) сильнее `.mt-nopic` по весу; `--photo-bg` светлый в обеих темах. Без входа — подмена fetch в вкладке и прямой импорт модулей; sw.js отдаёт старый код, снять перед проверкой.
- Аудит паспортов 2026-10-29: docs/audit/AUDIT-PASSPORTS-UI.md. Форма: product-block.js:31,67-69,114-156, form.js:66,98,133,160,207, wire-form.js:41,100,134; PDF: passport-pdf-v2-refs.ts:44-51, layout.ts:59-74,224-238, cover.ts:85-87, core/passport-images.js:21.
