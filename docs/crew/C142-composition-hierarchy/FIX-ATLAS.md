# C142 — карта: связи и колонки

статус: готово

сделано:
1. ✅ `products.sostav` не отдаёт `requests`. Заявка идёт состав → «Что купить» → заявка. Словарь не менялся.
2. ✅ `modules` col 2, `parts` col 3. Колонки 2 и 3 были заняты — проектирование и паспорта на слое «Описание» (`paper`), col 0 и 1.
3. ✅ `modules→needs`: шаг `mod-sostav` отдаёт, `needs.potrebnost` принимает.
4. ✅ `modules>work` и `parts>work`: шаги `mod-raboty` и `part-raboty` отдают, `work.sostav-pozicii` принимает.
5. ✅ `suppliercatalog>parts`: шаг «Детали и сырьё». `products>stock`: приём «Бронь по составу».

файлы: `backend/pwa/sections/atlas-data.js`
проверки: `atlas-brief.test.mjs` 5/5. `dc atlas --check` — структура в порядке. «Код новее карты» — не структура.
риски: проектирование и паспорта строкой ниже. Легенда слоя products длиннее. `kit.css` не трогал. Не коммит.
