# C249 — вынос fontDir (только пункт 4)

Статус: сделано. Пункты 1–3 (finance ↔ supply) не трогались.

## Было → стало

| Было | Стало |
|--|--|
| Определение `fontDir()` в `modules/product-passport/passport-pdf.ts` | Чистая функция пути в `common/print/font-dir.ts:9`. Правил паспортов нет. |
| `offers/offer-pdf`, `salesorders/order-pdf`, `qr/qr-pdf`, `shipments/shipment-pdf` импортировали паспорт | Импорт из `common/print/font-dir` |
| `common/print/tech-sheet-pdf` тянул `passport-pdf` | Импорт соседнего `./font-dir` |
| PDF паспорта (`passport-pdf-v2`, `passport-pdf-v2-stand`, `passport-registry-pdf`) брали путь из `passport-pdf` | Импорт из `common/print/font-dir` |
| Тесты модуля паспорта | Реэкспорт `passport-pdf.ts:5` оставлен |

Кандидаты пути те же: файл по-прежнему на два уровня под `src/` или `dist/`. Печать не менялась.

## Проверки

- `npx tsc --noEmit` — 0
- jest print/passport/offers/salesorders (+ qr, tech-sheet) — 18 suites, 101 tests PASS
- eslint затронутых файлов — 0

## Не сделано

C249b finance↔supply не сделан.
