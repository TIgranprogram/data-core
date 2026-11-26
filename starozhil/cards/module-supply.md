---
hash: 310816647513
id: module-supply
kind: module
sources: [backend/src/modules/supply/supply.controller.ts, backend/src/modules/supply/supply.service.ts, backend/src/modules/supply/supply-stock-request.controller.ts, backend/src/modules/supply/supplier-contract.controller.ts, backend/src/modules/supply/supply-invoice.service.ts, backend/src/modules/supply/supplier-catalog.service.ts]
checked: 2026-11-26
---
# Снабжение

> Черновик — локальный ИИ (наряд 003, факты `tools/starozhil/module-facts.mjs`), принял Claude 2026-11-13.

**Зачем:** полный цикл закупки: заявка → счёт поставщика → оплата → приёмка на склад; договоры и каталог поставщиков.

**Где** (маршруты — `supply.controller.ts`, `supply-stock-request.controller.ts`):
- Заявки: `/api/supply/requests` — список, создание, правка, корзина и восстановление, фото, `:id/receive` (приёмка), `:id/rollback-receipt` (отмена приёмки). Коллекция `supplyrequests` — **общая с CRM kppdf**.
- Счета: `/api/supply/invoices` — реквизиты, строки заявок, объединение, приёмка, отдельные `:id/payments` и подтверждение `:id/undated-payment`. Коллекции `supplyinvoices` и `supplyinvoicepayments`.
- Рабочий склад: открытые заявки читаются из `GET /api/stock/items/:id/requests`, заявка на материал создаётся через `POST /api/stock/items/:id/request`. Контроллер снабжения проверяет область склада.
- Договоры: `/api/supply/contracts` — CRUD (`supplier-contract.controller.ts`). Коллекция `suppliercontracts`.
- Каталог поставщика: `/api/supply/catalog/items`, `counts`, `template`, `export`, `import` (Excel), `bulk`, фото. Коллекция `supplieritems`.
- Экран — `backend/pwa/sections/requests.js` и связанные.

**Правила:**
- Менеджер и администратор могут вернуть в истории отдельное поле заявки «Примечание» или «Доставка». Сервер сверяет ожидаемое значение, меняет только это поле и пишет событие. В корзину заявку переносит администратор, вернуть её может и менеджер с подтверждением пароля.
- Финансовая база счёта фиксируется после первого платежа новой истории, подтверждения полной оплаты без даты или начала приёмки. Добавление строк и объединение используют ту же проверку `lockReason` в `supply-invoice.service.ts`. Оплаченные и отменённые счета не объединяются.
- Если при объединении найдены дубли, вариант «Добавить без дублей» требует прав администратора. Для него дублирующиеся заявки отправляются в корзину.
- При приёмке заявки без связанного материала `SupplyService.receive` использует `StockService.receiveWithItem`. Создание или привязка материала, движение и отметка приёмки сохраняются одной транзакцией.
- Позиция каталога уникальна по паре «артикул + цвет» у поставщика — `supplier-catalog.service.ts:420`.
- Импорт каталога — только `.xlsx` с обязательными колонками и лимитом строк — `supplier-catalog.service.ts:434`.

**Связи:** [[module-fill-audit]] — пробелы в заявках и счетах; склад (`stockmovements`) — приёмка пишет движения; деньги — сумма заявки идёт в выплаты.

**Ловушки:**
- Формат общих данных описан в `docs/crew/C257-shared-compat-contract/CONTRACT.md`. Карточка заявки и приёмка используют разные флаги записи C262 и C265.
