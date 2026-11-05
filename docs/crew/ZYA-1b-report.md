# ЗЯ-1b — отчёт backend (2026-11-05, не закоммичено)

Статус: готово. tsc 0; jest supply+stock+offers 27 сьютов / 349 зелёных; eslint чисто.

## Изменено
- `common/admin-override.ts`: `OverridePlan`, `assertAdminActor` (403), `overrideConfirm` (confirm:true + причина ≥3, иначе 400).
- `supply/dto-invoice.ts`: `AdminOverrideDto {confirm?, reason?}`.
- `supply/supply.service.ts`: `rollbackReceipt` (план: приход, остаток; confirm: `stock.cancelMovement`, сброс `receivedQty/At/To/receiveUid`, статус `ordered`/`requested`, снятие `receiptBoundaryAt` если принятых строк в счёте нет, `orders.recheck`, журнал `supply.receipt_rollback`). Остатка не хватает — blocker и 409, склад не трогается. Новых полей нет.
- `supply/supply-invoice.service.ts`: `unpay` (сторно: `paid→issued`, строки `paid:false`, `paymentSnapshot/paidAt` убраны — расход уходит из календаря; сумма/дата/причина сохраняются в `paymentAdjustments` (`payment_reversed`, delta −сумма) и в журнале `supply.invoice_unpay`). Есть приёмка — 409 «сначала откатите приёмку».
- `supply/supply-invoice.schema.ts`: тип операции `payment_reversed` (коллекция только data-core).
- `supply/supply.controller.ts`: `POST requests/:id/rollback-receipt`, `POST invoices/:id/unpay` (`@Roles('admin')`, 200).
- `docs/MAP.md`: оба маршрута. Тесты: +6 в supply.service.spec, +6 в supply-invoice.service.spec (admin проходит+журнал, менеджер 403, без причины 400, нехватка остатка 409, приёмка при unpay 409).

## Для frontend (ЗЯ-1c)
- Шаг 1: `POST /supply/requests/:id/rollback-receipt?dryRun=1` или тело `{}` → `{dryRun:true, canProceed, warnings[], blockers[], relatedAction}`; показать warnings, при `canProceed:false` — blockers и без кнопки.
- Шаг 2: тело `{confirm:true, reason}` → заявка (`get`). То же для `POST /supply/invoices/:id/unpay` → счёт.
- Ошибки: 400 без причины, 409 блок (русский текст), 403 не admin. openapi.json не перегенерирован (нужен Docker).
- Не сделано (вне объёма): п.6, 7(цена после приёмки), 11, 12, 15, 17, 18, 22, 24 из ТЗ.
