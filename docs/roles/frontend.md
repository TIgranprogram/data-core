# Уроки роли frontend

> Закрытые темы — одна строка: дата · что было · как решено · источник. Перед работой — Grep по теме здесь.

- 2026-10-23 · combo с ленивыми вариантами · список рисуется синхронно из options(); ленивая загрузка — f.load (кэш + refresh() после ответа), не промис в options · ui/form.js (SPR-1)
- 2026-10-23 · pwa-guards падает на новом модуле · новый файл в `pwa/` → сразу `node backend/scripts/pwa-preload.mjs` (modulepreload в `index.html`) · SPR-2
- 2026-10-23 · разрезание большого файла: импорты по регулярке — ложные и пропущенные · проверять новые файлы `npx eslint --no-eslintrc --rule "no-undef:error" --rule "no-unused-vars:warn"`; неверные относительные пути ловит только `pwa-preload.mjs` (не `node --check`) · ПР-1
