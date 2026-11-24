# REPORT C255 — границы доменов + ESLint

**Вердикт:** принято координатором 24.11.2026. Полное «любой модуль только через index» **не включено** (42 прямых импорта) — так и задумано ТЗ.

## Сделано

1. Публичные `index.ts`: `incomes`, `salesorders`, `product`.
2. Правило `domain-boundaries/boundaries` (локальный плагин) + `audit-domain-boundaries.js`.
3. Включено и зелёно: закрытые файлы трёх доменов; платформа не тянет бизнес; `common/` (кроме spec) в эти три — только `index` или порт цикла.
4. Карта доменов в `docs/ARCHITECTURE.md`.
5. Хук: `tools/dc.mjs` / `tools/local-checks.mjs` / smoke в `datacore-verify`.
6. Циклы ≥3 — уже L-256 (`audit-cycles`), не дублировали.

## Проверки

- `node --test scripts/audit-domain-boundaries.test.mjs` — 6/6
- `node scripts/audit-domain-boundaries.js` — код 0
- `node scripts/audit-cycles.js` — пар 0, новых длинных 0 (снимок 10)

## Долг полного правила (`--census`)

Прямых импортов трёх доменов мимо index: **42**. Топ целей: `product-writes` (17), `income.schema` (6), `salesorders.module` (4). Топ импортёров: dicts, finance, offers, salesorders. Дальше — поэтапно переводить на `index` / порт, затем ужесточать правило. АБЗ-8 не открывали.

**Коммит:** отдельный от C259.
