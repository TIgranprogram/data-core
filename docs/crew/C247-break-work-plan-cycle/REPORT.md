# C247 — отчёт

**Статус:** ✅ готово  
**Класс:** S · код + проверки · прод не трогали · C248+ не начинали

## Сделано
- Тип `ModuleWork` → `backend/src/common/module-work.ts` (только интерфейс).
- `work-task.schema.ts` реэкспортирует тип из common.
- `order-line-plan/task-bars.ts` импортирует common, не `modules/work`.
- Nest: `work` → `order-line-plan` односторонне (как было).

## Проверки
| Команда | Итог |
|--|--|
| `node backend/scripts/audit-cycles.js -v` | **0** взаимных пар (было 1: work ↔ order-line-plan) |
| `npx tsc --noEmit` (backend) | 0 |
| `npx jest --silent src/modules/work src/modules/order-line-plan` | 7 suites / 48 tests PASS |

## Циклы ≥3
Скрипт ловит только пары. Ручной обзор рёбер work / order-line-plan / my-tasks: `my-tasks` → order-line-plan; order-line-plan ↛ work; work → order-line-plan. Треугольника с обратной дугой к work не видно.

## Транзакции / аудит / повтор
Не применимо (перенос типа).

## Не тронуто
C248+, pwa/admin, прод, контракт API.
