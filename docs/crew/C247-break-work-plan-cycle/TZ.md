# ТЗ C247 — Снять цикл work ↔ order-line-plan

**Программа:** [C246/CHECKLIST](../C246-architecture-modularity/CHECKLIST.md) · этап 1  
**Зачем:** взаимная пара модулей после АБЗ-1; нужны явные односторонние зависимости без цикла.  
**Класс:** S · **Max agents:** 1 · **Проверки:** `audit-cycles.js` = 0 пар; `tsc`; юнит затронутых  
**Транзакции / аудит / повтор:** не применимо — только перенос типа, поведение операций не меняется.

## Что сделать
1. Интерфейс `ModuleWork` из `work/work-task.schema.ts` перенести в `common/` (рядом с `work-step.ts`) как **тип без доменных правил**.
2. `work-task.schema.ts` и потребители импортируют тип из `common/`.
3. `order-line-plan/task-bars.ts` не импортирует `modules/work/*` (в т.ч. type-only).
4. Связь Nest `work` → `OrderLinePlanModule` оставить односторонней.
5. Дополнительно: убедиться, что нет очевидного цикла A→B→C→A между этими двумя и соседями (ручная пометка в REPORT; скрипт пар — обязателен).

## Файлы
- Читать: C246 REPORT; `work-task.schema.ts`; `task-bars.ts`; `work.module.ts`; `audit-cycles.js`.
- Менять: `backend/src/common/…` (новый тип), `work-task.schema.ts`, импорты `ModuleWork`, `task-bars.ts` при необходимости.
- Нельзя: pwa/admin, CRM-схемы, контракт API, C248+ в том же диффе.

## Критерии
- [ ] `node backend/scripts/audit-cycles.js` → 0 взаимных пар
- [ ] `npx tsc --noEmit` = 0
- [ ] юнит `order-line-plan` и `work` (затронутые) зелёные
- [ ] REPORT.md: до/после, путь типа, циклы ≥3 — заметка

## Нельзя
- Класть правила «В работе» в `common/`.
- Начинать C248 в незакоммиченном диффе этого этапа.
