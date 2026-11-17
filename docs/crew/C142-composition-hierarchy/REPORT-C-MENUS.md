# C142 волна C — меню «Модули» и «Детали»

статус: готово (код, без глаз и без коммита)

сделано:
1. ✅ `modules.js` — список (поиск, категория, таблица/карточка, normalize: сервер отдаёт массив) и карточка; состав через `compositionPeek` / `buildCompForm`; экспорт `moduleComp` для LAZY.
2. ✅ `parts.js` — `GET /materials?materialKind=part`; карточка: заготовка `partBlank` (API `/materials/:id/composition`, только сырьё) и `partWorkBlock`.
3. ✅ `main.js` экспорты сходятся: `modules`/`moduleComp`, `parts`/`partBlank`, `partWork`.
4. ✅ `view-as.js` APP_IDS: `modules`, `parts` (меню их показывает). Видимость роли всё ещё галочка «Продукция».
5. ✅ `pult/catalog.mjs` — `tools/starozhil/c142-facts.mjs` в NOT_ON_BUTTONS, строка `design-checks/compare.mjs` цела.
6. ✅ синтаксис `--check` по modules, parts, comp-editor, part-work, view-as, catalog.

файлы: `backend/pwa/sections/modules.js`, `parts.js`, `comp-editor.js`; `backend/pwa/core/view-as.js`; `pult/catalog.mjs`. book-*.js не трогал.

проверки: node --check зелёный. design-lint по этим файлам 0. Новые 18 линта — book-* и kit.css, не эта задача. jest `src/pwa-guards` не гонял: нет `backend/node_modules`.

риски: сортировка деталей на сервере всегда по имени. Отдельные галочки роли для модулей и деталей — нужно от backend (`APP_SECTIONS`), если захотят не через «Продукцию». Глазами не смотрел.
