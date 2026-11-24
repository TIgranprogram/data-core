# C248 — ourCompanies в common

**Статус:** готово · код не коммитил · прод не трогал.

## Сделано

1. ✅ Функция вынесена в `backend/src/common/our-companies.ts:8`. Тело запроса то же: `organizations.isOurCompany`, скрытие фирм «только для КП», `{id,name,full}`.
2. ✅ Внешние модули импортируют `common/our-companies`. `incomes.service.ts:47` только реэкспортирует для модуля доходов.
3. ✅ Правила оплат, формулы, `fontDir`, импорты finance↔supply не менялись.
4. ➖ C249, C250, CHECKLIST не трогал.

## Файлы

| Файл | Что |
|--|--|
| `backend/src/common/our-companies.ts` | новый источник |
| `backend/src/modules/incomes/incomes.service.ts` | импорт + реэкспорт, тело функции убрано |
| `finance.service.ts`, `financial-operations-reader.service.ts` | импорт common |
| `expenses.service.ts`, `payroll.service.ts` | импорт common |
| `salesorders.service.ts`, `production-orders.service.ts` | импорт common |
| `supply-invoice-payments.service.ts`, `supply-undated-payments.service.ts` | импорт common |
| `offers.service.ts` | `ourCompanies` из common; `IncomesService` по-прежнему из incomes |
| `offers.templates.spec.ts`, `financial-operations-reader.spec.ts` | импорт и `spyOn` на common |
| `docs/roles/maps/backend.md`, `docs/roles/backend.md` | якорь и урок |

Не менялись: pwa `ourCompanies`, `passport-import` (поле контекста), `common/raw-query.ts`, `common/print/*`, `passport-pdf.ts`.

## Grep

**До:** `ourCompanies` из `incomes.service` — 11 файлов (определение `incomes.service.ts:47`).

- `salesorders.service.ts:14`, `production-orders.service.ts:14`
- `finance.service.ts:17`, `financial-operations-reader.service.ts:10`, `financial-operations-reader.spec.ts:3` (`import * as incomes`)
- `expenses.service.ts:9`, `payroll.service.ts:9`
- `supply-invoice-payments.service.ts:13`, `supply-undated-payments.service.ts:5`
- `offers.service.ts:11` (вместе с `IncomesService`), `offers.templates.spec.ts:3`

**После:** импорт функции `ourCompanies` из `incomes.service` — **0**.

Импорт `{ ourCompanies }` из `common/our-companies` — 11 файлов (10 внешних + incomes). Спека reader: `import * as companies from '../../common/our-companies'`.

Остались импорты **класса** `IncomesService` (не функции): `offers.service.ts:12`, `test/e2e/financial-operations.e2e-spec.ts:2`.

## Проверки

| Команда | Итог |
|--|--|
| `npx tsc --noEmit` (из `backend/`) | exit 0 |
| `npx eslint` по 13 затронутым файлам | 0 errors; 5 warnings `no-explicit-any` (старые, incomes/salesorders) |
| `npx jest --silent src/modules/incomes src/modules/finance src/modules/expenses src/modules/payroll src/modules/supply src/modules/salesorders src/modules/offers` | 47 suites, 501 tests, все PASS |

## Риски

Нет смены ответа API. Шпион в reader смотрит на common: реэкспорт incomes шпиона не переносит.

Карта обновлена. Коммит: нет.
