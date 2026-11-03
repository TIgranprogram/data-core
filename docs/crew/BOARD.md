# Доска Crew — 2026-11-03

План порядка: `C:\Users\User\.cursor\plans\аудит_и_порядок_96f61e60.plan.md`  
Выпуск: v1.481 (CONTROL.md). React/Sentry/rewrite — нет.

## Сейчас

| ID | Агент | Класс | Суть | Статус |
|--|--|--|--|--|
| C001 | Cursor (замена Manus) | S | Закрыть смену: что сделано, HEAD, хвосты → отчёт координатору | done |
| C002 | локальная модель (вместо OpenCode) | S | АБЗ-3: только инвентаризация | partial — REPORT есть, таблица неполная (нет partners/finance/dicts) |
| C003 | Cursor | S | Добить инвентаризацию АБЗ-3 (полный grep) | done |
| C004 | Manus WIP | L | Панель счетов (invoice-workspace) — отчёт принят, **не в main** | wip — ждать C005 |
| C005 | Cursor | M | Smoke + VM-тесты панели (Node 20) | smoke+VM pass; браузер ещё нет |
| C005b | — | M | Браузер+дизайнер панели счетов в worktree | next |
| C006 | Cursor | S | Вердикт Nightshift vs Пульт: GUI не доделываем | done |
| C007 | Cursor | M | Выдача на готовые заказы + несколько позиций на один заказ (телефон) | done |
| C008 | Cursor | M | Склад «Плитные материалы» + роль «Кладовщик плит (телефон)» | done |

Worktree счетов: `D:\data-core\.manus\worktrees\soorwu5tl3w6zui0j26jlr`  
Отчёт: `docs/crew/C004-invoice-workspace-wip/`  
C004/C005b — панель счетов уже в main (13c496fa).

## Очередь после приёмки C001/C002

1. H1: слепок client-errors/slow (через access, по ТЗ).
2. H1: сужение BACKLOG (причины в «Будущее»).
3. H2: АБЗ-3 по шагам после инвентаризации C002.
4. Пользователь: пароль admin, restore-drill (не агенты).

## Правило бойскаута

Новая запись в общие с CRM коллекции — только через `StockService`/`SupplyService`, пока АБЗ-3 не закрыт.
