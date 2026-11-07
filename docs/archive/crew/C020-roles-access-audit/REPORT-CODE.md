# C020 волна B — код доступов

статус: готово

## Пункты ТЗ

- ✅ `sectionOpen`: `stock-mobile` открывает только `stock`, не `requests` (`app-sections.ts:95`).
- ✅ Спека: заявка при одном `stock-mobile` — `false` (`app-sections.spec.ts`).
- ✅ GET `/supply/requests` (список, его дергает `stock-mobile.js`: `received` и `ordered,paid`) — `@AppSection('requests', 'stock', 'stock-mobile')` (`supply.controller.ts:284`). Метод перекрывает класс.
- ✅ POST `requests/:id/receive` — то же (`supply.controller.ts:408`).
- ✅ Остальные write заявок и счетов — класс `@AppSection('requests')`. С POST `requests` снят метод `@AppSection('requests', 'stock')` (`:342`): иначе телефон создавал заявки, потому что `stock-mobile` по-прежнему открывает `stock`.
- ✅ `sees()`: убрано `stock-mobile && sections включает stock` (`api.js:53`). `onlyStockMobile` (`:56`) без изменений.
- ➖ Схема роли, JWT, VIEW-AS, incomes, pult — не трогались.

## Почему в декораторе остался `stock`

Метод заменяет класс целиком. Без `stock` роли только с «Остатки» (трубарез, лазер) получили бы 403 на тот же список и приёмку: экран склада зовёт их из `ops.js` и `stock-ops.js`. Телефону хватает и `stock-mobile`, и открытого `stock`.

## Проверки

- `npx jest` `app-sections.spec.ts` + `app-section.guard.spec.ts`: 13 passed.
- `node --input-type=module --check` на `api.js` через stdin: exit 0 (флаг с путём файла Node 24 не принимает).
- openapi / e2e не гонялись (маршрут не новый).

## Риски / нужно от других

- Трубарез и лазер больше не создают заявку из нехватки на складе (POST `/supply/requests` → 403 «раздел»). Приёмка и список у них живы.
- Телефон по-прежнему может GET `requests/lookup` и POST `aliases` (`@AppSection('requests','stock')`, роли manager). Это не создание заявки. Сузить — отдельным решением.
- Меню «Склад (телефон)» пропадёт у ролей только с «Остатки» после перелогина / `/auth/me` (старый `sections` в браузере).
- Глазами и выкладка — координатор. Коммит не делался.

карта обновлена (`docs/roles/maps/backend.md`). коммит: —
