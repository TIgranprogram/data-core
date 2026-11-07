# C036 Ш3 — отчёт (backend, 2026-11-07)
- `POST /supply/requests/bulk` (admin, manager), до `requests/:id`. Тело `{clientUid, items[1–200]:{materialId, qty>0, supplierId?}}` → `{items,total}`. `SupplyService.createBulk` — цикл по `create()`, `clientUid` = `<ключ>:<materialId>`.
- До записи: все позиции есть и в scope, без повторов, поставщик существует; иначе 400, ничего не записано.
- Поставщик — из прошлых закупок (чаще, затем свежее): общая логика `stock/purchase-history.ts`; `items/:id/ordered` через неё (при равном числе — свежий первым).
- `priceHint` = сумма: последняя цена за ед. у поставщика × qty; нет — `supplieritems.priceHint` × qty (допущение: цена за ед.); нет — пусто.
- `SupplyInput.supplierId` (внутр.); публичный `SupplyRequestDto` не менялся.
- Проверки: tsc 0; jest supply+stock 344 зелёных (`supply.bulk.spec.ts`); dc check: юнит 3095/3095.
- Не сделано: openapi.json (нужен Docker), e2e.
