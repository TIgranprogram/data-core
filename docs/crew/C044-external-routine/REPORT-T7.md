# REPORT-T7 — C047 Э3: норма, факт, метка проектирования, термины

**Статус: сделано** (кроме помощи «?» — её правит координатор; panels не трогал).

## Что сделано
1. **Норма только в изделии.** `sections/work-schedule.js` (панель wsstep): поле «Часов на 1 шт.» → виджет «Норма» только чтение + кнопка «Принять как норму» (`POST /work-facts/product/:id/apply`). `sections/work-composition.js`: `compositionEditor` получил `canEditHours` (по умолч. = canEdit) — в панели «Позиция заказа» часы только чтение + кнопка «Принять как норму»; в изделии (`productRoute`) — правка осталась.
2. **«Начал/Закончил» в карточке задания.** `sections/work.js`: новый блок «Факт работы» (для статуса `work`) с кнопками «Начал/Закончил» (`POST /orderline-plans/:id/steps/:stepId/mark`). `work-present.ts`: `presentRoute` отдаёт `stepId` шага плана (нужно для mark). В `work-composition.js` отметки ▶/■ убраны — факт только чтение.
3. **Метка «в проектировании».** `work-schedule.service.ts`: полоса `GET /work-schedule` получила `inDesign: boolean` (есть незакрытая `designtasks` по `incomeId`). `work-schedule.js`: подпись «в проектировании» на полосе. Юнит — `work-schedule.service.spec.ts` (`inDesign: true`).
4. **Термины.** `orders.js`: заголовок раздела «Позиции заказов» → «Доходы по заказам». `work.js`/`work-schedule.js`: «Рабочий»/«не назначен»/«Не назначен» → «Исполнитель»/«Без исполнителя».

## Проверки
- `npx tsc --noEmit` → exit 0.
- `npx jest src/modules/order-line-plan src/modules/work --runInBand` → 6 suites / 42 tests ✅.
- `node --input-type=module --check` × 4 файла pwa (work-schedule, work, orders, work-composition) — чисто.
- `node backend/scripts/design-lint.mjs` → новых 0 (всего 6432).
- `npx eslint` изменённых .ts → 0 errors.

## Не сделано / допущения
- Помощь «?» (`help-guide-data.js`/`help-flow-data.js`) — не трогал (по указанию).
- Метка исполнителя в таблице «В работе» на 390 — уже есть в карточке (`card.sub` содержит имя исполнителя); отдельной правки не делал.
- e2e/снимки не гонял (нет Docker/стенда).
