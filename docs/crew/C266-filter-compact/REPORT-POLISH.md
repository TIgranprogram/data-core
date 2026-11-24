# C266 — полировка после AUDIT (FAIL)

Статус: код P0 и P1. Глазами стенд после правки не смотрел. Не коммитил.

## Пункты

- P0 заявки ✅ `panels.css:194` — селектор `.page .list-screen` (не прямой ребёнок). Шапка `relative`, `--topbar-bg: var(--bg)`, без нового `background`. Высота окна и скролл `.table-wrap` (`:268`).
- P0 долги ✅ тот же блок: список в `.m-body` внутри `.money`. Вкладка «Отчёт» без `.list-screen` не запирается.
- P0 склад ➖ эталон не сужал: тот же `:has`, ручка фильтров `relative` (`:276`).
- P1 hints ✅ `list.js:240` — серый текст только при `L.hintsOn`.
- P1 счётчик ✅ `list.js:76` — число в h1 скрыто, если чип считает. Продукция: «Все N» (`products.js:69`), воронка без абзаца (`:65`).
- P1 сброс ✅ `list.js:123` — выбранный чип с `defaultValue` пишет в адрес `all`, кнопка видна слева.
- P1 блоки заказов ✅ `plain` у «Несопоставленные» и «Договоры без заказа».
- P2 ➖ не делал.
- Счета: класс `list-screen` с вкладки снят (`invoices-tab.js:79`), иначе страница запиралась без таблицы.

## Проверки

`node --input-type=module --check` — list.js, products.js, invoices-tab.js, matching-queue.js, salesorders-unassigned.js, exit 0.
`jest src/pwa-guards`: 410 зелёных, 1 красный — design-lint. В списке нет блока fill (`panels.css:194+`). Красные хвосты прежние: ff-*/ls-reset, screens.css R6, list.js длиннее 400. Глазами нет.
