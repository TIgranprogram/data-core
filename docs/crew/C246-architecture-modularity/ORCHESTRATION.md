# Оркестрация 24.11.2026

Параллель без пересечения файлов:

| Поток | Агент | Scope | Статус |
|--|--|--|--|
| C248 | backend | `ourCompanies` → `common/our-companies.ts` + импортеры | в работе |
| C250 | backend | `INVENTORY.md` + `common/raw-query.ts` (без перевода вызовов) | в работе |
| C249a | backend | только `fontDir` → `common/print` | в работе |
| C249b | — | finance↔supply | **после** C248 (`finance.service.ts`) |

Приёмка и коммиты — координатор, по одному этапу после зелёных отчётов. Прод не трогаем.

## Волна 24.11 (расширение)

| Поток | Агент | Scope |
|--|--|--|
| C251 | backend | хозяин incomes (продолжается) |
| C256 | backend | audit-cycles ≥3 + ворота |
| C257 | architect | черновик CONTRACT shared |
| C258 | backend | PLAYBOOK DTO (docs) |

Вход: [PROGRAM.md](PROGRAM.md) · [LOCKS.md](LOCKS.md).
