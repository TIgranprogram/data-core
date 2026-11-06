# CL-C отчёт, список B
Статус: частично (всё, что есть в kit, заменено; остальное — в docs/crew/CL-C-requests.md).
Сделано: button()/iconButton()/select() в fill, work, work-route, composition, tech-sheet, matching-queue, supplier-catalog (кнопки), staff (select). Остальные пункты ТЗ (prompt/confirm, chips, table, empty, toast) в моих файлах уже не встречались либо не нужны (fill: toast(e.message) -> toastError).
grep -c "h('button'|h('select'|h('table'" до -> после: supplier-catalog 11->3, matching-queue 8->1, fill 3->1, work 4->1, work-route 7->0, composition 4->1, tech-sheet 2->0, stock-mobile 2->2, stock 2->2, staff 2->1, home 5->5, invoice-workspace 3->3.
Остаток: плитки-кнопки (cat-tile, sec-tile, go-tile, td-pass, td-chip, ls-opt, m-fg-h, m-cart-x, fill-head, .tag), селекты с disabled-опциями/name/динамические, file input с file.files[0], инлайн-кнопка числа — нужного варианта в kit нет (список в CL-C-requests.md).
Проверки: --check модулей ок; design-lint по моим файлам — нарушений нет (новые 20 — в offers.js/dicts.js списка A); dc check — импорты ок, design-lint красный из-за списка A; sections/*.test.mjs 37/37.
Не менял: home.js, stock.js, stock-mobile.js, invoice-workspace.js (всё упирается в kit).
