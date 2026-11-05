# ДС-1 шаг 1 — отчёт (frontend)
Статус: готово, не закоммичено.
- ✅ `card()` (kit/index.js): параметры `variant` ('long' | 'table') и `body`; класс `k-hover` ставится сам при `onClick`. long — 6 строк + «Развернуть» (aria-expanded); table — body = kit `table()` внутри карточки.
- ✅ kit.css: `.k-hover` — translateY(-2px) + --shadow-lg (hover:hover и no-preference); в reduce — только рамка `--border-strong`; focus-visible — контур `--primary`; стили `.k-card-long/.k-card-table`. Токены только существующие.
- ✅ Витрина #kit (sections/kit.js): блок «варианты long / table» (с кликом и без).
- ✅ DESIGN §5: исключение box-shadow при наведении.
- ➖ Старые классы и экраны не тронуты; screens.css, list.js, main.js, core/api.js не трогал.
Проверки: module --check (index.js, kit.js) ok; pwa-import-check 0 ошибок; design-lint 0; pwa-guards 205 зелёных.
Не проверено глазами (снимков нет). Дубли наведения (kit.css:144/163 и др.) пока не слиты — следующие шаги.
Карту frontend.md не обновлял (ТЗ не требовало якорей; card — ui/kit/index.js).
