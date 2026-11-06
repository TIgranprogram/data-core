# ТЗ: правые панели, волна 2 (ПМ-1) — позиция заказа, заявка, контрагент, позиция склада

- Класс: L. Исполнитель: `datacore-frontend` (1). После — приёмка `datacore-designer`. Не коммитить.
- Образец (уже на проде, v1.555): карточка изделия — `backend/pwa/sections/products.js:118–163`, `products/card-blocks.js`, `product-attachments.js`, `work-route.js`. Эталоны kit: `section({ title, count, body, open? })`, `stack(...блоки)`, `actions`, `empty` (`backend/pwa/ui/kit/index.js:139–150`).
- Правила (из `docs/crew/C-PANELS-AUDIT/REPORT.md` «Общие правила»):
  1. Блок `extra` панели — `stack(...)` из секций `section()` с числом в шапке; заголовков `.section-title` (линия без рамки) в панели не остаётся.
  2. Пустой блок — секция с `count: 0` и одной строкой `h('p', { class: 'muted small' }, '…')` внутри; без `empty()`-плашки с большими отступами.
  3. Видимых кнопок в `card.actions` ≤ 3 (одна главная); остальное — `more: true` (уходит в «⋯» шапки). Переходы «к связанным» — не кнопки, а секции.
  4. Самодельные `details`/`summary.section-title` (напр. `partners.js` «Прошлые годы») → вложенная `section()`.
  5. Inline `style:` не добавлять; новых классов вне kit не заводить (design-lint R3/R5/R8).
  6. Открытое состояние секций при перерисовке сохранять, если блок перерисовывается сам (как `product-files.js` `open` + `dataset.key`).

## Scope (только эти файлы)
1. Позиция заказа: `sections/orders.js:200–230` (card), `order-design.js:43–56`, `order-work.js:53–70`, `order-reservations.js:29–47`, `paymentsBlock` в `orders.js`.
2. Заявка: `sections/requests.js:408–460` (card, `extra`, `invoiceBlock`), `request-step.js:181–200` если там блоки панели. `requests.js` не длиннее 531 строки (design-lint L8 — не расти).
3. Контрагент: `sections/partners.js:81,136,160–185,252–278`.
4. Позиция склада: `sections/stock.js:76,235–285`, `item-orders.js:19–50`, `stock-passport.js:65`. Кнопки (`stock.js:259–270`): видимыми оставить «+ Принять», «− Выдать», «Забронировать»; остальные — `more: true`.

## Не читать
`backend/src`, `docs/archive`, `*.test.mjs` (кроме запуска), `ui/kit/*` не менять (только импорт; если нужен новый эталон — стоп, вопрос координатору).

## Проверки (сам)
- `node --input-type=module --check < файл` для каждого изменённого.
- `node backend/scripts/design-lint.mjs` — «новых 0».
- `node --experimental-vm-modules --test backend/pwa/sections/*.test.mjs` — зелёные.
- `grep -n "section-title" ` по изменённым файлам — в панелях 0 (в формах можно).

## Отчёт (≤ 15 строк)
По каждой панели: что стало секциями, какие кнопки ушли в «⋯», файл:строки. Что не сделано и почему.
