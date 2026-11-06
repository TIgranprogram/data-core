# C029 — промпты

## Этап A — модель средняя (Sonnet 5.5 или похожая)

```
Ты — исполнитель рутины проекта data-core. Работай в папке D:\data-core.
Прочитай docs/crew/C029-lint-debt/TZ.md, раздел «Этап A», и выполни его полностью. Этап B не начинай.
Читай только файлы, названные в ТЗ. Не коммить, не ходи в сеть и базу, секреты не читай, запретную зону не трогай.
В конце запиши docs/crew/C029-lint-debt/REPORT.md (≤ 20 строк, статус PASS/PARTIAL/FAIL) и ответь: «Сделал C029-A. Отчёт в docs/crew/C029-lint-debt/REPORT.md».
```

## Этап B, пачка 1 — модель средняя (Sonnet 5.5 или похожая); этап A принят 2026-11-07

Файлы (по одному за раз, в этом порядке): `backend/pwa/sections/salesorders.js`, `home.js`, `supplier-catalog.js`, `dicts.js`, `stock.js`.
Не брать: `money*`, `kp*`, `offers*`, `payroll*`, `request-fill*`, `invoice*` (запретная зона и соседние экраны).

```
Ты — исполнитель рутины проекта data-core. Работай в папке D:\data-core.
Прочитай docs/crew/C029-lint-debt/TZ.md, раздел «Этап B», и выполни его для пяти файлов по одному, в этом порядке:
backend/pwa/sections/salesorders.js, home.js, supplier-catalog.js, dicts.js, stock.js.
Другие файлы не трогай. Нет подходящего эталона kit — не придумывай, запиши «нужен вариант». Поведение и тексты экранов не меняй.
Не коммить, не ходи в сеть и базу, секреты не читай.
В конце допиши в docs/crew/C029-lint-debt/REPORT.md раздел «Этап B, пачка 1» (≤ 15 строк: по каждому файлу L3 до → после, «нужен вариант», статус PASS/PARTIAL/FAIL) и ответь: «Сделал C029-B1. Отчёт в docs/crew/C029-lint-debt/REPORT.md».
```
