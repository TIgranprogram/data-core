# C242 — frontend

**CODE FROZEN.** Реализация и локальные проверки PASS; независимая QA/архитектурная/визуальная приёмка — отдельно.
✅ Четыре таблицы: отдельные оси/unit, сечение первым у труб, stable server sort/pages, нулиmuted+«Нет в наличии», withParts0 исключает прежние PDM/profile; held1 остаётся явным фильтром.
✅ Nativepipe/sheet — одна строка на materialId без коллизий/phantomcells; пересчёт3м=3м, явные приёмка/добавление через прежний guardedконтур. P2: countMode multiple/unknown закрывает inlinecount во всех3nativeтаблицах с явной причиной; single/new сохранён. C240readonly — текст без write-handlers, синтетические события не пишут; native/admincount/create/note сохранены.
✅ Catalogue/lookup/facets/typeTiles полные и coalesced по zone/role/scope; размерные разделители нормализованы. W/H/D формы только изstored dims, неизменённые оси omitted, read-onlyразбор не backfill; depth сохраняется, не добавлен как пустая колонкаwood.
✅ Kit: columnsFor/sortFor послеquery+seqguard; новый снимокheader/rows/export не мутирует source. Fullstockexport10001/10123, отмена/ошибка⇒0частичныхфайлов; старыйcap10000 других клиентов сохранён. Kit-коммит отдельно отsections.
Файлы: core/facets,stock-list; sections/stock,stock-types,metal,pipe-grid,sheet-grid,wood-grid и4stock-*helpers; atlas-stock/help-guide/kit; ui/kit/list,list-view,filter; ui/list-export; pwa/index; DESIGN§4. Тестыc242-stock-tables,c242-list-export,C240grids,wood.
Проверки: полный адресный набор55/55 (22browser+4C240+7wood+11export/query+11facets), guards411/411, imports418/418, design-lint0NEW, atlas/diffcheckPASS. Лог: qa/frontend-tests.log; точный snapshot — qa/frontend-summary.json.
Доказательства:14табличныхPNG вevidence/frontend (main+native+wood+mainzone4 вдвухтемах),3PNGполейправойформы,2readonlyPNG и1P2multiplePNG. Это настоящий main.js/fullshell в изолированном HTTPfixture2560/1440, не prod/stand и не компонентный макет; placeholder80×60×3 не активный q.
Самопроверка: параметры/нули/fullyreserved/разныеID/куски видимы, формы достижимы до конца; fakeAPI не выдаётся за servernumeric/ACL-проверку. Полнота103/10123 и metadata-columns через страницы проверены; самостоятельного нового CSS нет.
➖ Backend/full/e2e/OpenAPI/stand и независимый designer — координатор/QA. StageC/БД/прод не менялись, коммит/деплой не выполнялся. Карта frontend обновлена; опорный коммит36bdd4dc.
