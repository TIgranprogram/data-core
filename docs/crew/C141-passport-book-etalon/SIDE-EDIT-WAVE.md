# C141 — правка в книжке (волна side-edit)

Дата: 2026-11-18

## Сделано
- Клики «Сначала» без информационных тостов (только flash на листе или слот справа).
- Книжка закрывается только крестиком (не Esc, не фон).
- Правая колонка:
  - `materials` / `parts` → `openMaterialsInBook`
  - `dimensions` / `weightKg` → `openDimsInBook`
  - `installation` → `openInstallationInBook`
  - `composition` → `openCompositionInBook` (тот же редактор, что «Изменить состав»; колонка шире `.is-wide`)

## Файлы
- `book-side-edit.js`, `book-focus.js`, `composition.js` (`compositionFormFor`)
- `kit.css` (`.bk-side.is-wide`)
