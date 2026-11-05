# ORDER W0-A (design-lint, хуки, dc order)
- design-lint: L1 храповик (baseline.total, только вниз; `--accept` только с `--user-approved`, итог не поднимает; `--allow-special` — закрытый список исключений, 5 записей 2026-11-05 в design-allow.json), L2–L9 (админка в тех же правилах, kit/special исключён из L4/L8), `--json`. L10 в плане §3 не определён — не делал.
- Хуки: .githooks/pre-commit (синтаксис staged js/mjs + design-lint), commit-msg: kit+sections в одном коммите — отказ, кроме только строк import и метки «Перенос: kit». Многострочный import не проходит (строже).
- `dc order` + кнопка «Порядок интерфейса» (pult/catalog.mjs, gen-docs). Пишет tools/logs/ORDER-PROGRESS.json (gitignored; H4 ждёт копию в docs/crew — не делал). «Экран на эталонах» пока = нет файлов в baseline (A1 браузера — позже).
- Baseline зафиксирован заново: итог 8294 (было 4730 по старым правилам; рост — новые L2–L9/admin). Часть B потом уменьшит.
- Проверки: dc.test 10/10; tsc 0; импорты 0 ошибок. dc check красный не по моей части: (а) pwa-guards modulepreload — часть B добавила модуль, нужен `node backend/scripts/pwa-preload.mjs`; (б) design-lint +1 L6 (новое имя kit без витрины/DESIGN) — часть B. Мой baseline сам не вырастет: --accept отказывает при росте.
- Не коммичено. Хук-файлы права +x не менял (git на Windows).
