# CL-B — отчёт (склад и заказы на эталоны kit)

Статус: частично, основное сделано. Коммитов нет.

## Сделано
- Склад: stock-ops, stock-ops-res, stock-zones, stock, reservations, reservation-edit, warehouse-mobile — `h('button')` -> `button()`/`iconButton()`; «Складов пока нет» -> `empty()`; кнопка «Принять без счёта» без `this`.
- Заказы: orders, order-design, order-lines, order-reservations, order-shipments, order-work, item-orders, salesorders*, salesorders-matching/-unassigned — кнопки на `button()`/`iconButton({menu})`, ссылка «КП» на `link()`, вкладки «История заказа» на `segmented()`.
- ops, ops-weight: `button()` / `iconButton()`.
- Ошибки: все `toast(errText(e))`, `toast(e.message)`, `toast(errText(e),{error:true})` -> `toastError(e)` (ранее без error:true всплывало как «успех»).
- `window.prompt/confirm/alert` в моих файлах не найдено (salesorders-matching `confirm(` — локальная функция).
- pipe-grid.js, table.cal — не тронуты (исключения).
- Обновлён `backend/pwa/index.html` (`pwa-preload.mjs`, список был устарел).

## Числа
- `grep -c "h('button'"` по моим файлам: 73 -> 7.
- design-lint: 0 новых; итог 6297 (на старте 6424, часть — работа GLM).
- Проверки: `--input-type=module --check` на всех изменённых — ок; `dc check` — зелёный; `node --test` — тестов в моих путях нет.

## Не сделано (нужен вариант kit -> см. CL-B-requests.md)
- Плитки склада `cat-tile` / `sec-tile` (stock.js:114,129): нужен `card({size:'S'})` с картинкой-art и раскрытием (aria-expanded).
- Мобильные: `m-cart-x`, `mob-act`, шапка в stock-mobile:399 — kit mobile.js без аналога.
- Тег-кнопка `tag active` (stock-zones:76) — `tagPick` не подходит (свой список).
- Пустые тексты `ops-empty` в stock-ops:119 и «Ничего не найдено»/EMPTY в salesorders-unassigned:38 — оставлены (смена дерева состояний).
- Чипы-фильтры `type:'chips'` — это конфиг list.js, уже kit.

## Итерация 2 (по сообщению координатора)
- Все `h('select')` (9 мест в 7 файлах) -> kit `select()`; `h('select')` в моих путях: 0. Динамические options дописываются через append, enhanceSelect сохранён.
- `button({cls})`: `mob-arr-accept`, `so-add`, `btn-warm` возвращены.
- design-lint 0 новых (итог 6284), `dc check` зелёный. Плитки и mobile — как просили, не тронуты.

## Допущения / потери вида
- Потеряны только `sop-toggle-manual` и inline-отступ у «Взять всё из списка».
- Конец строк файлов приведён к CRLF (как в рабочей копии), иначе design-lint видел «новые» L3.
- Браузером экраны не проверялись.
