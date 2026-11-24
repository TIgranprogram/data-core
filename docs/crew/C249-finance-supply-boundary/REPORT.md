# C249b — граница finance ↔ supply

Статус: сделано. fontDir уже был в C249a ([REPORT-fontDir.md](REPORT-fontDir.md)) и не менялся. Прод не трогал, коммита нет.

## Было → стало

| Было | Стало |
|--|--|
| `finance.service.ts` импортировал `invoice-payment-summary`, `invoice-financials`, `cost-center` | Суммы из `common/invoice-amounts.ts:26`. Агрегаты оплат — `SupplyService.invoicePaymentSummaries` (`supply.service.ts:117`), вызов `finance.service.ts:109`. Модуль импортирует `SupplyModule` |
| `financial-classification.service.ts` импортировал `financials` / `legacyReconciliation` из supply | Импорт `common/invoice-amounts.ts` |
| `financial-operations.ts` импортировал `costCenterLabel` из `supply/cost-center` | `common/cost-center-label.ts:5`. Коды прямой приёмки остались в `supply/cost-center.ts` |
| `financial-operations-reader` брал `moscowToday` из `invoice-financials` | `common/moscow-today.ts:2` |
| Расчёты сумм, НДС и разноса жили в `supply/invoice-financials.ts` | Тело в `common/invoice-amounts.ts`. Supply реэкспортирует. Дата факта — `invoice-financials.ts:12` |
| fontDir в паспорте | Уже вынесен в C249a, этот этап не трогал |

Прямых импортов файлов `supply/` из `finance/` — 0, кроме `SupplyModule` и `SupplyService`. Формулы календаря те же.

## Проверки

- `npx tsc --noEmit` — 0
- jest `modules/(finance|supply)` — 18 suites, 276 tests PASS
- eslint затронутых файлов — 0
- `audit-cycles.js` — взаимных пар 0

## Не трогал

fontDir, `common/print`, `our-companies.ts`, `common/raw-query.ts`, CHECKLIST, PDF паспортов, `docs/crew/C250-*`.
