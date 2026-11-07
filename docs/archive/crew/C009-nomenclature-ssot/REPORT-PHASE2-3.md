# Отчёт C009 фазы 2–3

`готово | фазы 2–3 | ✅ | supplier-catalog.js, stock.js, stock-requests.js, facets.js, fill-material-dims.js | module --check + facets.test | фаза 4 не делалась`

**Фаза 2:** очередь «Связать с позицией» на лендинге; rowAction; кнопка «Создать позицию склада» → stock + PATCH связи; поиск только `/stock/items` (free:false); materials не создаются с сервера каталога.
**Фаза 3:** скрипт `fill-material-dims.js` план→`--apply` (только пустые dims/assortment); фильтры склада: `dims.length`/`thickness` важнее разбора имени.
**НДС/API:** openapi/MAP не менялись.
