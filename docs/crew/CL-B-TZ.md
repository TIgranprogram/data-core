# ТЗ агенту datacore-frontend — часть Claude: склад и заказы на эталоны kit

Класс L. Правила те же, что в docs/crew/GLM5-TZ.md (раздел «Задачи — правила для всех», «Проверки», «Запреты») — прочитай их, они общие. Язык русский. Не коммить, не пушь, не трогай docker/прод/секреты.

**Твои пути (только они):** `backend/pwa/sections/`: `stock*.js`, `movements.js`, `reservations.js`, `reservation-edit.js`, `issue.js`, `order-issue.js`, `warehouse*.js`, `orders.js`, `order-*.js`, `salesorders*.js`, `item-orders.js`, `ops*.js`, `metal.js`, `pipe-grid.js`.
**Не твои:** `ui/kit/**`, `screens.css`, GLM-файлы (home, staff, docs*, money*, payroll*, invoice*, requests*, request-*, design*, partners, offers, contracts, kp, dicts, profile, help, chat, history, search), `products*`, `passports*`, `backend/src`.

**Задача:** заменить самодельное на kit: `h('button'` → `button()`/`iconButton()`, ручные `.chips` → `tabs()`, `h('select'` → `pick`/`field`, ручные пустые тексты («Пусто», «Ничего не найдено», «Нет данных») → `empty()`, `toast(e.message…)` → `toastError(e)`, `window.prompt/confirm/alert` → `confirmDlg`/`modal`, плитки склада → `card({size:'S'})`, кликабельные карточки → `card({onClick})` (даёт k-hover). `table.cal`, `pg-table`, `pipe-grid` (сетки) — закрытые исключения, не трогать. Поведение, тексты, права не менять. Новых CSS-классов и inline-style не заводить. Нужен элемент, которого нет в kit → строка в `docs/crew/CL-B-requests.md`, экран оставь.
Порядок: склад (`stock*`, `movements`, `reservations`, `issue`, `order-issue`, `warehouse*`) → заказы (`orders`, `order-*`, `salesorders*`, `item-orders`) → `ops*`, `metal`.
**Проверки:** `node --input-type=module --check < файл` на каждый; `node backend/scripts/design-lint.mjs` (итог только вниз); `tools/dc.cmd check`; `node --test` для файлов с *.test.mjs рядом.
**Отчёт:** `docs/crew/CL-B-report.md` ≤ 40 строк: что сделано по каждой группе, числа `grep -c "h('button'"` до/после, невыполненное, допущения.
