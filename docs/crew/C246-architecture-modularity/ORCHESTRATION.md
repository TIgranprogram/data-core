# Оркестрация 24.11.2026

Параллель без пересечения файлов:

| Поток | Агент | Scope | Статус |
|--|--|--|--|
| C248 | backend | `ourCompanies` → `common/our-companies.ts` + импортеры | в работе |
| C250 | backend | `INVENTORY.md` + `common/raw-query.ts` (без перевода вызовов) | в работе |
| C249a | backend | только `fontDir` → `common/print` | в работе |
| C249b | — | finance↔supply | **после** C248 (`finance.service.ts`) |

Приёмка и коммиты — координатор, по одному этапу после зелёных отчётов. Прод не трогаем.
