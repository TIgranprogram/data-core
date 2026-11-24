# C246 — чек-лист продолжения (читать первым)

> Любой ИИ: сначала [LOCKS.md](LOCKS.md) + этот файл → первый `[ ]` → `TZ.md` → работа → `REPORT.md` → `[x]` здесь и BACKLOG → коммит только этапа.  
> Пакет: [PROGRAM.md](PROGRAM.md) · [DECISION.md](DECISION.md) · [RAILS.md](RAILS.md) · [BEYOND-CHECKLIST.md](BEYOND-CHECKLIST.md) · [PLAN.md](PLAN.md).

## Правила безопасности этапа

- Закрытый `[x]` не переоткрывать без дефекта в ТЗ или «да» владельца ([LOCKS](LOCKS.md)).
- Не начинать следующий этап той же волны, пока текущий не `[x]` (исключение: явно разрешённая параллель в PROGRAM).
- Ветка `main` после этапа — зелёные проверки из ТЗ.
- Выкладка — только после зелёных проверок и решения координатора (M+/L).
- Код «наполовину» не коммитить: добить этап или откатить дерево.
- Успех: явные зависимости, нет циклов, нет чужих записей мимо хозяина.

## Этапы

- [x] **C246** — аудит + решение + план (+ REVIEW-NOTES). [DECISION](DECISION.md) · [PLAN](PLAN.md)
- [x] **C247** — снять цикл `work` ↔ `order-line-plan`. [Отчёт](../C247-break-work-plan-cycle/REPORT.md)
- [x] **C248** — `ourCompanies` в `common` (без доменных правил доходов). [Отчёт](../C248-our-companies-common/REPORT.md)
- [x] **C249** — `fontDir` + граница finance↔supply. [fontDir](../C249-finance-supply-boundary/REPORT-fontDir.md) · [C249b](../C249-finance-supply-boundary/REPORT.md)
- [x] **C250** — инвентаризация писателей + `raw-query` без массового перевода. [Отчёт](../C250-raw-query-inventory/REPORT.md) · [INVENTORY](../C250-raw-query-inventory/INVENTORY.md)
- [x] **C251** — хозяин-операций `incomes`. [Отчёт](../C251-incomes-owner-writes/REPORT.md) · L-251
- [x] **C252** — хозяин-операций `salesorders`. [Отчёт](../C252-salesorders-owner-writes/REPORT.md) · L-252
- [ ] **C253** — хозяин/фасад `products`. [ТЗ](../C253-products-owner-writes/TZ.md)
- [ ] **C254** — shared CRM **мелкими поставками** (подчек-лист в ТЗ). [ТЗ](../C254-shared-collections-layer/TZ.md)
- [ ] **C255** — границы постепенно после очистки доменов; **финал после C254**. [ТЗ](../C255-domain-boundaries-eslint/TZ.md)

После C255 → [BEYOND-CHECKLIST.md](BEYOND-CHECKLIST.md) (C256 можно раньше — аддитивно).

## Сейчас (обновлять при каждом этапе)

**Активный этап:** C253 следующий  
**Статус:** C246–C252 ✅ · C256 ✅ · C257[~] · C258 ✅  
**Последнее обновление:** 24.11.2026
