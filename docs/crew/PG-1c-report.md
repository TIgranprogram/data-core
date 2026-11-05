# ПГ-1c отчёт
Статус: сделано, не закоммичено, глазами не проверено.
- (1) `kit/auto-more.js` (102 строки): `autoMore({load,render,root,limit,skeleton,cls,summary,text,onError})` → `{el,reload({keep}),more,repaint,items,total,resp,busy,destroy}` + `moreSentinel` (только наблюдатель). data-k="autoMore". Экспорт в `kit/index.js`, блок «Подгрузка порциями» на #kit (с одной имитацией сбоя), строка в DESIGN §4.
- (2) Переведены: design-requests.js, docs-orders.js, invoices-tab.js, invoice-workspace-forms.js (самописный сентинел/failBlock/«Показать ещё» удалены); kit/list.js — на `moreSentinel` (загрузка, keep, periods остались в list).
- Поведение то же: 1-я порция/фильтр → reload(), правка → reload({keep:true}), выбор/открытая группа живут в экранах. Мелочь: при пустом списке подвал не рисуется.
Группы коммитов:
 A kit: backend/pwa/ui/kit/auto-more.js, ui/kit/index.js, ui/kit/list.js, sections/kit.js, docs/DESIGN.md, docs/roles/maps/frontend.md, docs/crew/PG-1c-report.md
 B sections-перевод: sections/design-requests.js, docs-orders.js, invoices-tab.js, invoice-workspace-forms.js
 (design-requests/docs-orders/invoices-tab/forms содержат и прежнюю незакоммиченную работу ПГ-1b.)
Проверки: module --check всех файлов ок; pwa-import-check 0 ошибок; preload 79 модулей; design-lint: мои файлы 0, итог «новых 4» = чужие (stock-issue R2/L2, salesorders/admin L8) — не вырос; pwa-guards: 1 падает («нет новых нарушений») только из-за этих чужих 4.
