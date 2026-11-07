# Приёмка отчёта Manus — панель счетов (WIP)

**Дата:** 2026-11-03  
**Источник:** `.manus/worktrees/soorwu5tl3w6zui0j26jlr` @ HEAD `075a9af7` (detached)  
**Вердикт координатора:** отчёт **принят как статус WIP**. Код **не** принимать в main и **не** выкладывать.

## Согласен с отчётом

- Функция начата, не закончена.
- Не коммитили / не пушили / сайт v1.481 не трогали — верно.
- Блокеры до merge: браузер 390/1024/1920(+2560), повтор дизайнера, `dc check` + pwa-guards, TEST-LOG, выкинуть `.work`.

## Факты worktree

- Грязное дерево: правки pwa (requests, invoices-tab, request-step, kit, card…), tools/site-audit, docs.
- Новые файлы: `invoice-workspace*.js`, `ui/kit/readonly.js`, fixtures, `docs/roles/tz/INVOICE-WORKSPACE.md`.
- Есть каталог `.work` — в коммит не класть.

## Порядок продолжения (утверждаю)

1. C005 — финальная проверка fixture + клики QA (не прод).
2. Дизайнер повторно → «принято».
3. `dc check` + pwa-guards + PWA tests; e2e уже 487 — повторить если трогали backend (по отчёту UI-heavy).
4. TEST-LOG + без `.work`.
5. Коммит только путей панели (не `git add -A`); метки Класс L, Дизайнер: принято.
6. push → preflight → release — только после 1–5.

## Не делать сейчас

- Не merge worktree в main «как есть».
- Не release.sh.
- Не параллелить с АБЗ-3 на тех же pwa-файлах без раздела scope.
