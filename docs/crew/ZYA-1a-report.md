# ЗЯ-1a — отчёт backend (2026-11-05, не закоммичено)

Статус: готово. tsc 0; jest supply+offers 12 сьютов / 207 зелёных; eslint чисто; audit-cycles — только прежняя пара incomes<->product-requests.

## Сделано
- Хелпер: `common/admin-override.ts` — `isAdminActor` (role admin ИЛИ isOwner), `overrideReason` (≥3 симв., 400), `adminOverride` (AuditService.log, action `admin.override`, details before/after/meta{rule,reason}).
- isOwner: на сервере и так проходит `@Roles` (roles.guard:34, permissions.guard:85, stock-scope, money) — приравнен к admin; хелпер так же.
- Строка 4 (реквизиты строки при счёте выставлен/оплачен, приёмки нет): `supply.service.ts:488-520` (update, +5-й параметр actor, AuditService), журнал `:~585`, правило `supply.invoiced_fields`. После границы/принятой строки блок остаётся (ЗЯ-1b).
- Строка 3 (priceHint/qty строки счёта): `supply-invoice.service.ts:641 adminEditLine` (через updateLine: amount, история цены, paymentAdjustments у оплаченного), маршрут `supply.controller.ts:353-368`; правило `supply.invoiced_line`.
- Строки 25/26 КП: `offers/offer-rules.ts:25-58` (checkMove/checkEditable возвращают true=обход), `offers.service.ts:189,205,226,229`; admin: «Оплачено» (если нет orderId) — правка и выход; любые переходы статуса; цена к «Отправлено» обязательна для всех.
- DTO: необязательное `reason` — `supply/dto.ts` (SupplyRequestDto), `offers/dto.ts` (UpdateOfferDto, OfferStatusDto). Причина обязательна только при реальном обходе (раньше это было 400 — регрессии нет).
- Модули: AuditModule подключён в supply.module и offers.module; AuditService — @Optional последним параметром (старые spec не сломаны).
- Тесты: supply.service.spec (+6), supply-invoice.service.spec (+5), offers.admin.spec (новый, 5), offer-rules.spec (+4): admin проходит и пишет журнал; менеджер — прежняя ошибка; без причины 400; после приёмки блок.

## Не сделано / нужно
- ЗЯ-1b (B-обходы) и C-блоки не тронуты. Строка 16 (stageBack) и 20 — уже admin, не менялись.
- openapi.json не перегенерирован (нужен Docker+Mongo): добавлено поле `reason` в 3 DTO, MAP.md не правил.
- Нужно от frontend (1c): слать `reason` в PATCH /supply/requests/:id, PATCH /offers/:id, POST /offers/:id/status; показывать правку для admin.
- Допущение: у admin старый ответ 400 «Цена и количество заблокированы» остаётся только при прямом вызове сервиса, через API admin уходит в adminEditLine.
