# C240 — frontend
PASS исполнения; независимая QA/архитектурная/визуальная приёмка ожидается.
✅ stockScreenAccess единый для меню/URL/canFollow/mount; stock gate обязателен, director fallback оба, explicit[] никакого дополнительного, native/owner/admin сохранены.
✅ Дополнительный pipe/sheet readOnly: поля количества/примечания без write/blur/keyboard handlers; synthetic события дали 0 мутаций; write-панели закрыты, профиль без open/new разрешён.
✅ view-as сохраняет absent против [] и не переносит настройку настоящего admin; refreshMe учитывает stockViews и перестраивает экран.
✅ Форма роли: умолчание/явный список, create omit, update resetStockViews:true без массива. Classic IIFE DataCoreRoleStockViews.mount/read с явными DOM/helpers перед admin.js; L8 baseline не менялся.
Runtime: core/route-access.js,view-as.js;main.js;sections/pipe-grid.js,sheet-grid.js,atlas-stock.js,help-guide-data.js;admin/admin.js,index.html,role-stock-views.js. Новые 3 тестовых файла c240-* в core/sections/admin.
Проверки: route/view-as+C189 29/29; admin 5/5; actual-main grid browser 4/4; native wood browser 7/7 — всего 45 PASS. Guards 405/405, imports/syntax 412/412, design-lint новых 0, atlas --check и diff --check PASS.
Доказательства: evidence/fixture/pipe-director-light.png,sheet-director-dark.png,role-stock-views-light.png,role-stock-views-dark.png. Заполненные локальные HTTP/DOM фикстуры, не прод: grid-поиск совпадает с единственной строкой; admin — компонент roleForm/roleBody, не реальная stand-панель. Server-side фильтрация этой фикстурой не проверяется.
Эталон: существующая pg-table (DESIGN §4 исключение) и admin roleCard/checkGrid/select; новых CSS/kit-компонентов/токенов нет. Внешний вид самопроверен; дизайнерский PASS не присваивался.
Важно: API-права директора не отзываются и не расширяются. На прод ничего не записывал, код не коммитил/не выкладывал; C242 collision/paging не исправлялись.
JS frozen. Карта frontend обновлена, опорный коммит 36bdd4dc; якоря route-access.js:67,87; pipe-grid.js:144; sheet-grid.js:39; admin/role-stock-views.js:3.
