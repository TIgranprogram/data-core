# REPORT-T6 — один Гант: безопасное ядро (перенос — отдельно)

**Статус: ядро сделано, перенос `ui/gantt.js`/`.gt-*` и «В работе → Гант» — отдельно с дизайнером** (по решению пользователя 2026-11-08).

## Что сделано
1. `backend/src/modules/work/work.controller.ts:82-87` — `PATCH /work-tasks/:id/plan` помечен `@ApiOperation({ deprecated: true })`; код и маршрут не удалены (публичный контракт).
2. `backend/src/modules/order-line-plan/work-schedule.service.ts` — полоса `GET /work-schedule` теперь несёт:
   - `deadline: string | null` — срок заказа (изготовление → отгрузка, как у заданий «В работе»);
   - `overdue: boolean` — просрочен ли шаг к сроку (срок прошёл и шаг не «done»).
   - `status` уже был (`plan`/`work`/`done` = ждёт/идёт/сделано) — не менялся.
   - Новые чистые функции `barDeadline(o)` и `barOverdue(deadline, today, status)` (вынесены для юнита).
3. `backend/src/modules/order-line-plan/work-schedule.service.spec.ts` — юнит на `barDeadline`/`barOverdue` и на то, что полоса несёт `deadline`/`overdue` из заказа.

## Проверки (числа)
- `npx tsc --noEmit` → exit 0.
- `npx jest src/modules/order-line-plan --silent --runInBand` → 2 suites / 16 tests ✅.
- `npx jest src/modules/work --silent --runInBand` → 4 suites / 26 tests ✅.
- `npx eslint` изменённых файлов → 0 errors, 0 warnings.
- e2e не гонял (нет Docker). Контракт `/work-schedule` расширен новыми полями (аддитивно), openapi не перегенерировал (нет Docker) — `deprecated` попадёт в openapi при следующей регенерации.

## Не сделано (перенос — отдельно с дизайнером)
- Перенаправление «В работе → Гант → `#workschedule`»; удаление `ui/gantt.js` и `.gt-*`.
- `planner`: визуализация `status`/`overdue` на полосе (красная метка), факт-полоса, режим «По этапам заказа», масштаб «Месяц», витрина `#kit` — это фронтенд-часть Т6 (у пользователя стоит отдельно).

## Допущения
- «Срок заказа» = `productionDeadline ?? shipDate` (как у заданий «В работе», `design-present.orderDeadline`), чтобы Гант и «В работе» не разошлись.
- `overdue` считается по календарной дате (не по рабочим дням), как было в старом `ui/gantt.js` (`dl < today`).
