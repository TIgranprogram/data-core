---
hash: d6ec3ba0b015
id: module-supply
kind: module
sources: [backend/src/modules/supply/supply.controller.ts, backend/src/modules/supply/supplier-contract.controller.ts, backend/src/modules/supply/supply-invoice.service.ts, backend/src/modules/supply/supplier-catalog.service.ts]
checked: 2026-11-13
---
# Снабжение

> Черновик — локальный ИИ (наряд 003, факты `tools/starozhil/module-facts.mjs`), принял Claude 2026-11-13.

**Зачем:** полный цикл закупки: заявка → счёт поставщика → оплата → приёмка на склад; договоры и каталог поставщиков.

**Где** (все маршруты — `tools/logs/starozhil/modules/supply.md`, 37 шт.):
- Заявки: `/api/supply/requests` — список, создание, правка, удаление и восстановление, фото, `:id/receive` (приёмка), `:id/rollback-receipt` (отмена приёмки). Коллекция `supplyrequests` — **общая с CRM kppdf**.
- Счета: `/api/supply/invoices` — создание, `:id/requests` (добавить заявки), `:id/lines/:lineId` (строка), `:id/merge-preview` + `:id/merge` (объединение), `:id/receive`, `:id/pay`, `:id/unpay`. Коллекция `supplyinvoices`.
- Договоры: `/api/supply/contracts` — CRUD (`supplier-contract.controller.ts`). Коллекция `suppliercontracts`.
- Каталог поставщика: `/api/supply/catalog/items`, `counts`, `template`, `export`, `import` (Excel), `bulk`, фото. Коллекция `supplieritems`.
- Экран — `backend/pwa/sections/requests.js` и связанные.

**Правила:**
- После начала приёмки финансовые поля счёта закрыты; цену правит только администратор с причиной — `supply-invoice.service.ts:79` (`lockReason`).
- Позиции в счёт добавляются только до первой приёмки — `supply-invoice.service.ts:441`.
- Оплаченные и отменённые счета не объединяются — `supply-invoice.service.ts:508`.
- Позиция каталога уникальна по паре «артикул + цвет» у поставщика — `supplier-catalog.service.ts:420`.
- Импорт каталога — только `.xlsx` с обязательными колонками и лимитом строк — `supplier-catalog.service.ts:434`.

**Связи:** [[module-fill-audit]] — пробелы в заявках и счетах; склад (`stockmovements`) — приёмка пишет движения; деньги — сумма заявки идёт в выплаты.

**Ловушки:**
- Схемы `supplyrequests` и складских коллекций — копии kppdf: менять синхронно (`AGENTS.md`, «Известные ловушки»).
- Файлы больше 600 строк: `supply.service.ts` 827, `supply-invoice.service.ts` 819 — в чистку (план, этап 3).
