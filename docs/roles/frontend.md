# Уроки роли frontend

> Закрытые темы — одна строка: дата · что было · как решено · источник. Перед работой — Grep по теме здесь.

- 2026-10-23 · combo с ленивыми вариантами · список рисуется синхронно из options(); ленивая загрузка — f.load (кэш + refresh() после ответа), не промис в options · ui/form.js (SPR-1)
- 2026-10-23 · pwa-guards падает на новом модуле · новый файл в `pwa/` → сразу `node backend/scripts/pwa-preload.mjs` (modulepreload в `index.html`) · SPR-2
