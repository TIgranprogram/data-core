# W5 — изделие по шаблону «Карточка объекта»
- `sections/products.js` card = `screenCard({...})` + gallery/photo*; шапка (артикул, название, статус), `facts` (цена, себестоимость, раздел·группа, габариты, вес), `more` («Подробнее»), все кнопки (В КП, Изменить состав, Паспорт, Техописание, Паспорт+техописание, клонировать…) — в «⋯» (`menu`).
- `products/tabs.js` `productWarns` (warnCard переноса → «Что дальше»); `productTop` удалён.
- `products/card-blocks.js` `warnNote` → `warnCard` (кнопки «Открыть …», «Это разные»).
- `products/fill-block.js` `fillNext`: nextCard «Заполнено N из M… Дальше: …» + главная «Заполнить» первого пункта; остальные — «Ещё N».
- atlas-data.js products: tpl card, tplStatus ok. kit не менялся. Проверки: --check, guards 307/307, design-lint 0 по products.
- Не сделано: tools/tpl-baseline.json (legacy 21→ по факту меньше) — вне scope; снимков стенда нет.
