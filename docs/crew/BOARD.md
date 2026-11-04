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
| C009 | Cursor | XL | Единая номенклатура: договор + заявки + каталог + фильтры | фаза 1 выложена; фаза 2 — в чате C009 |
| C010 | — | M | Мобильный склад: «Полностью отгруженные» | queued — TZ; код не начинать |
| C011 | datacore-analyst | XL | Аудит бизнес-логики | done — REPORT/FIX-TZ |
| C012 | datacore-designer | L | Правая панель + карточка заказа | done — REPORT/FIX-TZ |
| C013 | datacore-architect (Grok) | XL | HA Дом↔Sportin: автосинхрон и переключение | P0 done (Sportin на 122039); P1/P2 ждут «да» |
| C016 | Cursor (координатор) | S | Аудит: нужна ли страница «Сопоставление» | done — `C016-matching-nav-audit/REPORT.md` |
| C017 | Cursor (оркестратор) | M | Производство: заказы/сопоставление/design/work | done — `C017-production-polish/REPORT.md` |
| C018 | Cursor (оркестратор) | L | Доска/группы/счётчик + доки/КП аудит | done — `C018-production-products-docs/REPORT.md` |
| C019 | Cursor | M | «Смотреть как роль» (только просмотр) | ТЗ VIEW-AS — другой чат |
| C020 | access + backend | L | Починка доступов ролей | волны A/B запущены — `ROLES-FIX.md` |
| C021 | координатор | M | Аудит «Ведение проекта» + вид вкладки «Время» | audit done — `C021-devlog-time-audit/`; UI локально, выкладка ждёт |

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
