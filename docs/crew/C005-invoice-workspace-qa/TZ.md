# ТЗ C005 — Финальная проверка панели счетов (worktree)

**Класс:** M · **Агент:** Cursor / OpenCode · **Проверки:** fixture + браузер, без коммита

## Shared pack

- Код только в worktree: `D:\data-core\.manus\worktrees\soorwu5tl3w6zui0j26jlr`
- Прод и `main` не трогать. Коммит запрещён до вердикта дизайнера.
- Чек-лист: `docs/crew/C004-invoice-workspace-wip/CHECKLIST.md`

## Что сделать

1. В worktree: поднять fixture `backend/pwa/fixtures/invoice-workspace.html` (как в ТЗ `docs/roles/tz/INVOICE-WORKSPACE.md` worktree).
2. Пройти клики из CHECKLIST п. клики QA (хотя бы fixture + 390/1024/1920).
3. Прогнать: pwa-import-check, invoice-workspace.test.mjs, `dc check` если возможно без Docker; результат в REPORT.
4. `.work` не коммитить.
5. REPORT: PASS/PARTIAL + список непройденных кликов.

## Менять

- Только `docs/crew/C005-invoice-workspace-qa/REPORT.md`
- Код worktree — только если найден явный баг блокера (тогда список файлов в отчёте).

## Нельзя

- merge в main, push, release, прод.
